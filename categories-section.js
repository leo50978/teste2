// ============= CATEGORIES-SECTION.JS - VERSION AVEC NOUVELLE STRUCTURE THÈME =============

// Import du thème
import theme from './theme-root.js';

// Import Firebase
import { db } from './firebase-init.js';
import { collection, query, onSnapshot, getDocs, limit } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CategoriesSection {
    constructor(containerId, options = {}) {
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`❌ Container #${containerId} non trouvé`);
            return;
        }

        this.options = {
            collectionName: options.collectionName || 'products',
            productsPerPage: options.productsPerPage || 12,
            initialCategory: options.initialCategory || 'all',
            initialLineKey: options.initialLineKey || '',
            openFiltersOnInit: options.openFiltersOnInit || false,
            imageBasePath: options.imageBasePath || './',
            isInModal: options.isInModal || false,
            maxRealtimeProducts: options.maxRealtimeProducts || 500,
            ...options
        };

        this.theme = theme;
        
        // États
        this.state = {
            allProducts: [],
            filteredProducts: [],
            displayedProducts: [],
            categories: [],
            categoryNamesById: {},
            columnNamesByCategoryId: {},
            structureByCategoryId: {},
            variants: [],
            selectedCategory: this.options.initialCategory,
            searchQuery: '',
            priceRange: { min: 0, max: Infinity },
            selectedColors: [],
            selectedVariants: this.options.initialLineKey ? [this.options.initialLineKey] : [],
            sortBy: 'createdAt-desc',
            currentPage: 1,
            totalPages: 1,
            loading: true,
            filtersOpen: false,
            activeFiltersCount: 0,
            currentImageIndex: new Map()
        };

        this.elements = {};
        this.currentModal = null;
        this.ProductModalClass = null;
        this.uniqueId = 'catalogue_' + Math.random().toString(36).substr(2, 9);
        
        // S'abonner aux changements de thème
        this.unsubscribeTheme = this.theme.subscribe(() => {
            this.applyThemeToStyles();
            if (this.state.allProducts.length > 0) {
                this.renderProducts();
            }
        });
        
        this.init();
    }

    getImagePath(filename) {
        if (!filename) return '';
        if (filename.startsWith('http')) return filename;
        return `${this.options.imageBasePath}${filename.split('/').pop()}`;
    }

    formatPrice(price) {
        return new Intl.NumberFormat('fr-HT', {
            style: 'currency', 
            currency: 'HTG',
            minimumFractionDigits: 2
        }).format(price || 0);
    }
    
    toNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }
    
    isProductVisible(product) {
        if (typeof product?.status === 'string') return product.status === 'active';
        if (typeof product?.active === 'boolean') return product.active !== false;
        return true;
    }
    
    getProductImages(productData) {
        // Règle stricte: uniquement le champ products.images (jamais variations.images)
        if (Array.isArray(productData?.images)) {
            return productData.images.filter(img => typeof img === 'string' && img.trim() !== '');
        }
        return [];
    }
    
    getProductColorNames(product) {
        const names = new Set();
        
        if (Array.isArray(product?.colors)) {
            product.colors.forEach(color => {
                if (typeof color === 'string' && color.trim()) names.add(color.trim());
                if (color && typeof color === 'object' && color.name) names.add(String(color.name).trim());
            });
        }
        
        if (Array.isArray(product?.variations)) {
            product.variations.forEach(v => {
                if (v?.color && String(v.color).trim()) names.add(String(v.color).trim());
            });
        }
        
        return Array.from(names);
    }
    
    getVariationLabel(variation) {
        const parts = [];
        if (variation?.color) parts.push(String(variation.color).trim());
        if (variation?.size) parts.push(String(variation.size).trim());
        if (variation?.volume) parts.push(String(variation.volume).trim());
        return parts.filter(Boolean).join(' • ') || (variation?.sku ? String(variation.sku) : '');
    }
    
    getProductVariationNames(product) {
        const names = new Set();
        if (Array.isArray(product?.variations)) {
            product.variations.forEach(v => {
                const label = this.getVariationLabel(v);
                if (label) names.add(label);
            });
        }
        return Array.from(names);
    }

    getProductStructureNames(productData) {
        if (!Array.isArray(productData?.categorySelections)) return [];
        const names = new Set();
        const categoryId = productData?.categoryId || null;
        const columnsById = categoryId ? (this.state.columnNamesByCategoryId[categoryId] || {}) : {};

        productData.categorySelections.forEach((selection) => {
            const columnId = selection?.columnId;
            const lineName = selection?.name;

            if (columnId && columnsById[columnId]) {
                names.add(columnsById[columnId]);
            }

            // Les lignes doivent aussi apparaître, sans préfixe
            if (typeof lineName === 'string' && lineName.trim()) {
                names.add(lineName.trim());
            }
        });
        return Array.from(names);
    }

    async loadColumnNamesByCategoryIds(categoryIds) {
        const current = { ...(this.state.columnNamesByCategoryId || {}) };

        await Promise.all(categoryIds.map(async (categoryId) => {
            if (!categoryId || current[categoryId]) return;

            try {
                const columnsRef = collection(db, 'categories_list', categoryId, 'columns');
                const snapshot = await getDocs(query(columnsRef));
                const map = {};
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    if (data?.columnName) {
                        map[doc.id] = String(data.columnName).trim();
                    }
                });
                current[categoryId] = map;
            } catch (error) {
                console.error(`❌ Erreur chargement colonnes pour catégorie ${categoryId}:`, error);
                current[categoryId] = {};
            }
        }));

        this.state.columnNamesByCategoryId = current;
    }

    matchesSelectedCategory(product, selectedCategory) {
        if (selectedCategory === 'all') return true;
        if (!product) return false;
        return product.categoryName === selectedCategory || product.categoryId === selectedCategory;
    }

    getSelectedCategoryId() {
        if (this.state.selectedCategory === 'all') return null;
        const directById = this.state.allProducts.find(p => p.categoryId === this.state.selectedCategory)?.categoryId;
        if (directById) return directById;
        const byName = this.state.allProducts.find(p => p.categoryName === this.state.selectedCategory)?.categoryId;
        return byName || null;
    }

    makeLineKey(categoryId, columnId, lineId) {
        return `${categoryId || ''}::${columnId || ''}::${lineId || ''}`;
    }

    parseLineKey(key) {
        const [categoryId, columnId, lineId] = String(key || '').split('::');
        return { categoryId, columnId, lineId };
    }

    async loadStructureForCategory(categoryId) {
        if (!categoryId) return;
        if (this.state.structureByCategoryId[categoryId]) return;

        try {
            const columnsSnap = await getDocs(query(collection(db, 'categories_list', categoryId, 'columns')));
            const columns = columnsSnap.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

            const structure = await Promise.all(columns.map(async (column) => {
                const linesSnap = await getDocs(query(collection(db, 'categories_list', categoryId, 'columns', column.id, 'lines')));
                const lines = linesSnap.docs
                    .map((doc) => ({ id: doc.id, ...doc.data() }))
                    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

                return {
                    id: column.id,
                    name: column.columnName || 'Sans nom',
                    lines: lines.map((line) => ({
                        id: line.id,
                        name: line.lineName || 'Sans nom'
                    }))
                };
            }));

            this.state.structureByCategoryId[categoryId] = structure;
        } catch (error) {
            console.error(`❌ Erreur chargement structure catégorie ${categoryId}:`, error);
            this.state.structureByCategoryId[categoryId] = [];
        }
    }
    
    loadCategoryNames() {
        try {
            const categoriesRef = collection(db, 'categories_list');
            onSnapshot(categoriesRef, (snapshot) => {
                const map = {};
                snapshot.forEach(doc => {
                    const data = doc.data();
                    if (data?.name) map[doc.id] = data.name;
                });
                
                this.state.categoryNamesById = map;
                
                // Recalculer les labels de catégories si des produits sont déjà chargés
                if (this.state.allProducts.length > 0) {
                    this.state.allProducts = this.state.allProducts.map(product => {
                        const resolvedName = product.categoryId
                            ? (this.state.categoryNamesById[product.categoryId] || product.categoryName)
                            : product.categoryName;
                        return {
                            ...product,
                            categoryName: resolvedName || 'non-catégorisé'
                        };
                    });
                    
                    this.extractCategories();
                    this.extractVariants();
                    this.applyFilters();
                }
            });
        } catch (error) {
            console.error("❌ Erreur chargement noms catégories:", error);
        }
    }
    
    getProductDisplayPrice(product) {
        const variations = Array.isArray(product?.variations) ? product.variations : [];
        const basePrice = this.toNumber(product?.basePrice ?? product?.price, 0);
        
        if (variations.length === 0) {
            return { value: basePrice, text: this.formatPrice(basePrice) };
        }
        
        const prices = variations.map(v => {
            const vp = this.toNumber(v?.price, NaN);
            return Number.isFinite(vp) && vp > 0 ? vp : basePrice;
        });
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        if (min === max) return { value: min, text: this.formatPrice(min) };
        return { value: min, text: `${this.formatPrice(min)} - ${this.formatPrice(max)}` };
    }

    // Appliquer les variables CSS du thème
    applyThemeToStyles() {
        const colors = this.theme.getColors();
        const fonts = this.theme.getFonts();
        const typography = this.theme.getTypography();
        
        // Créer ou mettre à jour les variables CSS
        const styleId = `theme-variables-${this.uniqueId}`;
        let styleEl = document.getElementById(styleId);
        
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        
        styleEl.textContent = `
            .catalogue-wrapper-${this.uniqueId} {
                --text-title: ${colors?.text?.title || '#1F1E1C'};
                --text-subtitle: ${colors?.text?.subtitle || '#7A746B'};
                --text-body: ${colors?.text?.body || '#4A4A4A'};
                --text-button: ${colors?.text?.button || '#FFFFFF'};
                --bg-general: ${colors?.background?.general || '#FFFFFF'};
                --bg-card: ${colors?.background?.card || '#F5F5F5'};
                --bg-button: ${colors?.background?.button || '#C6A75E'};
                --icon-standard: ${colors?.icon?.standard || '#1F1E1C'};
                --icon-hover: ${colors?.icon?.hover || '#C6A75E'};
                --font-primary: ${typography?.family || fonts?.primary || "'Cormorant Garamond', serif"};
                --font-secondary: ${fonts?.secondary || "'Manrope', sans-serif"};
            }
        `;
    }

    init() {
        this.applyThemeToStyles();
        this.renderStructure();
        this.addStyles();
        this.loadCategoryNames();
        this.loadProducts();
        this.addEventListeners();
        this.listenForModalEvents();

        if (this.options.openFiltersOnInit && window.innerWidth <= 768) {
            setTimeout(() => this.openDrawer(), 120);
        }
    }

    renderStructure() {
        this.container.innerHTML = '';
        
        const colors = this.theme.getColors();
        const fonts = this.theme.getFonts();
        
        const wrapper = document.createElement('div');
        wrapper.className = `catalogue-wrapper-${this.uniqueId}`;
        wrapper.style.cssText = `
            width: 100%;
            font-family: var(--font-secondary, 'Manrope, sans-serif');
            background: var(--bg-general, #F5F1E8);
            min-height: 100vh;
            position: relative;
        `;
        
        // Header différent selon qu'on est dans une modal ou pas
        const headerHtml = this.options.isInModal ? `
            <div class="catalogue-header" style="
                background: var(--bg-card, white);
                border-bottom: 1px solid ${colors?.background?.button || '#C6A75E'}20;
                padding: 0.75rem 1rem;
                position: sticky;
                top: 0;
                z-index: 10;
            ">
                <div class="search-bar" style="
                    width: 100%;
                    position: relative;
                ">
                    <input type="text" 
                        class="search-input"
                        placeholder="Rechercher un produit..."
                        style="
                            width: 100%;
                            padding: 0.75rem 1rem 0.75rem 2.5rem;
                            border: 1px solid var(--text-subtitle, #7A746B)40;
                            border-radius: 30px;
                            font-size: 0.95rem;
                            outline: none;
                            transition: all 0.3s;
                            background: white;
                            color: var(--text-body, #4A4A4A);
                        "
                    >
                    <i class="fas fa-search" style="
                        position: absolute;
                        left: 1rem;
                        top: 50%;
                        transform: translateY(-50%);
                        color: var(--icon-standard, #1F1E1C);
                        font-size: 1rem;
                    "></i>
                </div>
            </div>
        ` : `
            <div class="catalogue-header" style="
                background: var(--bg-card, white);
                border-bottom: 1px solid ${colors?.background?.button || '#C6A75E'}20;
                padding: 1rem 1rem;
                position: sticky;
                top: 0;
                z-index: 10;
                box-shadow: 0 2px 10px rgba(0,0,0,0.03);
            ">
                <div style="
                    max-width: 1400px;
                    margin: 0 auto;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h1 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            font-size: 1.5rem;
                            color: var(--text-title, #1F1E1C);
                            margin: 0;
                        ">Notre Collection</h1>
                        
                        <!-- Bouton filtre pour mobile (dans le header) -->
                        <button class="mobile-filter-header-${this.uniqueId}" style="
                            display: none;
                            background: var(--bg-card, #F5F5F5);
                            border: 1px solid var(--bg-button, #C6A75E)40;
                            border-radius: 30px;
                            padding: 0.5rem 1rem;
                            font-size: 0.9rem;
                            cursor: pointer;
                            align-items: center;
                            gap: 0.5rem;
                            color: var(--text-title, #1F1E1C);
                        ">
                            <i class="fas fa-sliders-h" style="color: var(--bg-button, #C6A75E);"></i>
                            <span>Filtres</span>
                            <span class="filter-count-header-${this.uniqueId}" style="
                                background: var(--bg-button, #C6A75E);
                                color: var(--text-button, #FFFFFF);
                                border-radius: 50%;
                                width: 20px;
                                height: 20px;
                                display: inline-flex;
                                align-items: center;
                                justify-content: center;
                                font-size: 0.7rem;
                                font-weight: bold;
                            ">0</span>
                        </button>
                    </div>
                    
                    <!-- Barre de recherche -->
                    <div class="search-bar" style="
                        width: 100%;
                        position: relative;
                    ">
                        <input type="text" 
                            class="search-input"
                            placeholder="Rechercher un produit..."
                            style="
                                width: 100%;
                                padding: 0.75rem 1rem 0.75rem 2.5rem;
                                border: 1px solid var(--text-subtitle, #7A746B)40;
                                border-radius: 30px;
                                font-size: 0.95rem;
                                outline: none;
                                transition: all 0.3s;
                                background: white;
                                color: var(--text-body, #4A4A4A);
                            "
                        >
                        <i class="fas fa-search" style="
                            position: absolute;
                            left: 1rem;
                            top: 50%;
                            transform: translateY(-50%);
                            color: var(--icon-standard, #1F1E1C);
                            font-size: 1rem;
                        "></i>
                    </div>
                </div>
            </div>
        `;
        
        wrapper.innerHTML = `
            ${headerHtml}

            <!-- Drawer filtres pour mobile -->
            <div class="filters-drawer-${this.uniqueId}" style="
                position: fixed;
                top: 0;
                right: 0;
                width: 85%;
                max-width: 320px;
                height: 100vh;
                background: var(--bg-card, white);
                z-index: 1001;
                transform: translateX(100%);
                transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                box-shadow: -5px 0 25px rgba(0,0,0,0.1);
                overflow-y: auto;
                display: flex;
                flex-direction: column;
            ">
                <!-- En-tête du drawer -->
                <div style="
                    padding: 1.5rem 1rem;
                    border-bottom: 1px solid var(--bg-button, #C6A75E)20;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: var(--bg-card, white);
                    position: sticky;
                    top: 0;
                    z-index: 10;
                ">
                    <h3 style="
                        font-family: var(--font-primary, 'Cormorant Garamond, serif');
                        font-size: 1.2rem;
                        color: var(--text-title, #1F1E1C);
                        margin: 0;
                    ">Filtres</h3>
                    <button class="close-drawer-${this.uniqueId}" style="
                        background: none;
                        border: none;
                        font-size: 1.5rem;
                        cursor: pointer;
                        color: var(--text-subtitle, #7A746B);
                        width: 36px;
                        height: 36px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                    ">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <!-- Contenu des filtres -->
                <div style="padding: 1rem; flex: 1; overflow-y: auto;">
                    <!-- Filtre par catégorie -->
                    <div class="filter-section" style="margin-bottom: 2rem;">
                        <h4 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            font-size: 1rem;
                            color: var(--text-title, #1F1E1C);
                            margin: 0 0 1rem 0;
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                        ">
                            <i class="fas fa-tag" style="color: var(--bg-button, #C6A75E);"></i>
                            Catégories
                        </h4>
                        <div class="categories-list-${this.uniqueId}" style="
                            display: flex;
                            flex-direction: column;
                            gap: 0.75rem;
                            max-height: 300px;
                            overflow-y: auto;
                            padding-right: 0.5rem;
                        "></div>
                    </div>

                    <!-- Filtre par prix -->
                    <div class="filter-section" style="margin-bottom: 2rem;">
                        <h4 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            font-size: 1rem;
                            color: var(--text-title, #1F1E1C);
                            margin: 0 0 1rem 0;
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                        ">
                            <i class="fas fa-euro-sign" style="color: var(--bg-button, #C6A75E);"></i>
                            Prix
                        </h4>
                        <div class="price-range">
                            <div style="
                                display: flex;
                                gap: 0.5rem;
                                margin-bottom: 1rem;
                            ">
                                <input type="number" class="min-price-${this.uniqueId}" placeholder="Min" style="
                                    width: 50%;
                                    padding: 0.75rem;
                                    border: 1px solid var(--text-subtitle, #7A746B)40;
                                    border-radius: 8px;
                                    font-size: 0.9rem;
                                    outline: none;
                                    color: var(--text-body, #4A4A4A);
                                ">
                                <input type="number" class="max-price-${this.uniqueId}" placeholder="Max" style="
                                    width: 50%;
                                    padding: 0.75rem;
                                    border: 1px solid var(--text-subtitle, #7A746B)40;
                                    border-radius: 8px;
                                    font-size: 0.9rem;
                                    outline: none;
                                    color: var(--text-body, #4A4A4A);
                                ">
                            </div>
                            <button class="apply-price-${this.uniqueId}" style="
                                width: 100%;
                                padding: 0.75rem;
                                background: var(--bg-button, #C6A75E);
                                color: var(--text-button, #FFFFFF);
                                border: none;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 0.9rem;
                                transition: background 0.3s;
                            ">Appliquer</button>
                        </div>
                    </div>

                    <!-- Filtre par couleur -->
                    <div class="filter-section" style="margin-bottom: 2rem;">
                        <h4 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            font-size: 1rem;
                            color: var(--text-title, #1F1E1C);
                            margin: 0 0 1rem 0;
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                        ">
                            <i class="fas fa-palette" style="color: var(--bg-button, #C6A75E);"></i>
                            Couleurs
                        </h4>
                        <div class="colors-list-${this.uniqueId}" style="
                            display: flex;
                            flex-wrap: wrap;
                            gap: 0.5rem;
                        "></div>
                    </div>
                    
                    <!-- Filtre de structure -->
                    <div class="filter-section" style="margin-bottom: 2rem;">
                        <h4 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            font-size: 1rem;
                            color: var(--text-title, #1F1E1C);
                            margin: 0 0 1rem 0;
                            display: flex;
                            align-items: center;
                            gap: 0.5rem;
                        ">
                            <i class="fas fa-layer-group" style="color: var(--bg-button, #C6A75E);"></i>
                            Sélections
                        </h4>
                        <div class="variants-list-${this.uniqueId}" style="
                            display: flex;
                            flex-wrap: wrap;
                            gap: 0.5rem;
                        "></div>
                    </div>
                </div>

                <!-- Pied du drawer avec bouton effacer -->
                <div style="
                    padding: 1rem;
                    border-top: 1px solid var(--bg-button, #C6A75E)20;
                    background: var(--bg-card, white);
                ">
                    <button class="clear-filters-${this.uniqueId}" style="
                        width: 100%;
                        padding: 0.75rem;
                        background: var(--bg-card, #F5F5F5);
                        color: var(--text-title, #1F1E1C);
                        border: 1px solid var(--bg-button, #C6A75E)40;
                        border-radius: 8px;
                        cursor: pointer;
                        font-size: 0.9rem;
                        font-weight: 500;
                        display: none;
                    ">Effacer tous les filtres</button>
                </div>
            </div>

            <!-- Overlay pour le drawer -->
            <div class="drawer-overlay-${this.uniqueId}" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 1000;
                display: none;
                opacity: 0;
                transition: opacity 0.3s ease;
            "></div>

            <!-- Bouton filtre mobile flottant (caché par défaut) -->
            <button class="mobile-filter-toggle-${this.uniqueId}" style="
                display: none;
                position: fixed;
                bottom: 1.5rem;
                right: 1.5rem;
                z-index: 99;
                background: var(--bg-button, #C6A75E);
                color: var(--text-button, #FFFFFF);
                border: none;
                border-radius: 50px;
                padding: 0.75rem 1.5rem;
                font-size: 0.95rem;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(198,167,94,0.3);
                align-items: center;
                gap: 0.5rem;
            ">
                <i class="fas fa-sliders-h"></i>
                <span>Filtres</span>
                <span class="filter-count-${this.uniqueId}" style="
                    background: white;
                    color: var(--bg-button, #C6A75E);
                    border-radius: 50%;
                    width: 22px;
                    height: 22px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 0.75rem;
                    font-weight: bold;
                ">0</span>
            </button>

            <div class="catalogue-container-${this.uniqueId}" style="
                max-width: 1400px;
                margin: 0 auto;
                padding: 1rem;
                position: relative;
            ">
                <!-- Desktop sidebar -->
                <aside class="desktop-sidebar-${this.uniqueId}" style="
                    display: none;
                    width: 280px;
                    flex-shrink: 0;
                ">
                    <div style="
                        background: var(--bg-card, white);
                        border-radius: 16px;
                        padding: 1.5rem;
                        border: 1px solid var(--bg-button, #C6A75E)20;
                        box-shadow: 0 4px 15px rgba(0,0,0,0.03);
                        position: sticky;
                        top: 2rem;
                    ">
                        <!-- En-tête filtres -->
                        <div style="
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            margin-bottom: 1.5rem;
                            padding-bottom: 1rem;
                            border-bottom: 1px solid var(--bg-button, #C6A75E)20;
                        ">
                            <h3 style="
                                font-family: var(--font-primary, 'Cormorant Garamond, serif');
                                font-size: 1.3rem;
                                color: var(--text-title, #1F1E1C);
                                margin: 0;
                            ">Filtres</h3>
                            <button class="clear-filters-desktop-${this.uniqueId}" style="
                                background: none;
                                border: none;
                                color: var(--text-subtitle, #7A746B);
                                font-size: 0.9rem;
                                cursor: pointer;
                                text-decoration: underline;
                                display: none;
                            ">Effacer tout</button>
                        </div>

                        <!-- Filtre par catégorie -->
                        <div class="filter-section" style="margin-bottom: 2rem;">
                            <h4 style="
                                font-family: var(--font-primary, 'Cormorant Garamond, serif');
                                font-size: 1.1rem;
                                color: var(--text-title, #1F1E1C);
                                margin: 0 0 1rem 0;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                            ">
                                <i class="fas fa-tag" style="color: var(--bg-button, #C6A75E);"></i>
                                Catégories
                            </h4>
                            <div class="categories-list-desktop-${this.uniqueId}" style="
                                display: flex;
                                flex-direction: column;
                                gap: 0.75rem;
                                max-height: 300px;
                                overflow-y: auto;
                                padding-right: 0.5rem;
                            "></div>
                        </div>

                        <!-- Filtre par prix -->
                        <div class="filter-section" style="margin-bottom: 2rem;">
                            <h4 style="
                                font-family: var(--font-primary, 'Cormorant Garamond, serif');
                                font-size: 1.1rem;
                                color: var(--text-title, #1F1E1C);
                                margin: 0 0 1rem 0;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                            ">
                                <i class="fas fa-euro-sign" style="color: var(--bg-button, #C6A75E);"></i>
                                Prix
                            </h4>
                            <div class="price-range">
                                <div style="
                                    display: flex;
                                    gap: 0.5rem;
                                    margin-bottom: 1rem;
                                ">
                                    <input type="number" class="min-price-desktop-${this.uniqueId}" placeholder="Min" style="
                                        width: 50%;
                                        padding: 0.75rem;
                                        border: 1px solid var(--text-subtitle, #7A746B)40;
                                        border-radius: 8px;
                                        font-size: 0.9rem;
                                        outline: none;
                                        color: var(--text-body, #4A4A4A);
                                    ">
                                    <input type="number" class="max-price-desktop-${this.uniqueId}" placeholder="Max" style="
                                        width: 50%;
                                        padding: 0.75rem;
                                        border: 1px solid var(--text-subtitle, #7A746B)40;
                                        border-radius: 8px;
                                        font-size: 0.9rem;
                                        outline: none;
                                        color: var(--text-body, #4A4A4A);
                                    ">
                                </div>
                                <button class="apply-price-desktop-${this.uniqueId}" style="
                                    width: 100%;
                                    padding: 0.75rem;
                                    background: var(--bg-button, #C6A75E);
                                    color: var(--text-button, #FFFFFF);
                                    border: none;
                                    border-radius: 8px;
                                    cursor: pointer;
                                    font-size: 0.9rem;
                                    transition: background 0.3s;
                                ">Appliquer</button>
                            </div>
                        </div>

                        <!-- Filtre par couleur -->
                        <div class="filter-section" style="margin-bottom: 2rem;">
                            <h4 style="
                                font-family: var(--font-primary, 'Cormorant Garamond, serif');
                                font-size: 1.1rem;
                                color: var(--text-title, #1F1E1C);
                                margin: 0 0 1rem 0;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                            ">
                                <i class="fas fa-palette" style="color: var(--bg-button, #C6A75E);"></i>
                                Couleurs
                            </h4>
                            <div class="colors-list-desktop-${this.uniqueId}" style="
                                display: flex;
                                flex-wrap: wrap;
                                gap: 0.5rem;
                            "></div>
                        </div>
                        
                        <!-- Filtre de structure -->
                        <div class="filter-section" style="margin-bottom: 2rem;">
                            <h4 style="
                                font-family: var(--font-primary, 'Cormorant Garamond, serif');
                                font-size: 1.1rem;
                                color: var(--text-title, #1F1E1C);
                                margin: 0 0 1rem 0;
                                display: flex;
                                align-items: center;
                                gap: 0.5rem;
                            ">
                                <i class="fas fa-layer-group" style="color: var(--bg-button, #C6A75E);"></i>
                                Sélections
                            </h4>
                            <div class="variants-list-desktop-${this.uniqueId}" style="
                                display: flex;
                                flex-wrap: wrap;
                                gap: 0.5rem;
                            "></div>
                        </div>

                        <!-- Pied avec bouton effacer -->
                        <div style="
                            padding-top: 1rem;
                            border-top: 1px solid var(--bg-button, #C6A75E)20;
                            margin-top: 1rem;
                        ">
                            <button class="clear-filters-desktop-${this.uniqueId}" style="
                                width: 100%;
                                padding: 0.75rem;
                                background: var(--bg-card, #F5F5F5);
                                color: var(--text-title, #1F1E1C);
                                border: 1px solid var(--bg-button, #C6A75E)40;
                                border-radius: 8px;
                                cursor: pointer;
                                font-size: 0.9rem;
                                font-weight: 500;
                                display: none;
                            ">Effacer tous les filtres</button>
                        </div>
                    </div>
                </aside>

                <!-- Contenu principal -->
                <main class="catalogue-main-${this.uniqueId}" style="flex: 1;">
                    <!-- Barre d'outils -->
                    <div class="catalogue-toolbar-${this.uniqueId}" style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        margin-bottom: 1rem;
                        padding: 0.5rem 0;
                    ">
                        <div class="results-count-${this.uniqueId}" style="color: var(--text-subtitle, #7A746B); font-size: 0.9rem;">
                            <span class="count">0</span> produits
                        </div>
                        
                        <div class="sort-selector" style="display: flex; align-items: center; gap: 0.5rem;">
                            <select class="sort-select-${this.uniqueId}" style="
                                padding: 0.5rem 1.5rem 0.5rem 0.75rem;
                                border: 1px solid var(--text-subtitle, #7A746B)40;
                                border-radius: 20px;
                                background: var(--bg-card, white);
                                cursor: pointer;
                                font-size: 0.85rem;
                                color: var(--text-body, #4A4A4A);
                                appearance: none;
                                background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
                                background-repeat: no-repeat;
                                background-position: right 0.3rem center;
                                background-size: 0.8rem;
                            ">
                                <option value="createdAt-desc">Nouveautés</option>
                                <option value="price-asc">Prix ↑</option>
                                <option value="price-desc">Prix ↓</option>
                                <option value="name-asc">A-Z</option>
                                <option value="name-desc">Z-A</option>
                            </select>
                        </div>
                    </div>

                    <!-- Grille produits -->
                    <div class="products-grid-${this.uniqueId}" style="
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 0.75rem;
                        margin-bottom: 2rem;
                        min-height: 400px;
                    "></div>

                    <!-- Loading -->
                    <div class="products-loading-${this.uniqueId}" style="
                        text-align: center;
                        padding: 3rem 1rem;
                        color: var(--text-subtitle, #7A746B);
                        display: block;
                    ">
                        <i class="fas fa-spinner fa-spin fa-2x" style="color: var(--bg-button, #C6A75E);"></i>
                        <p style="margin-top: 0.75rem; font-size: 0.9rem;">Chargement...</p>
                    </div>

                    <!-- Empty state -->
                    <div class="products-empty-${this.uniqueId}" style="
                        display: none;
                        text-align: center;
                        padding: 3rem 1rem;
                        background: var(--bg-card, white);
                        border-radius: 16px;
                        border: 1px solid var(--bg-button, #C6A75E)20;
                    ">
                        <i class="fas fa-box-open" style="font-size: 2.5rem; color: var(--text-subtitle, #7A746B); margin-bottom: 1rem;"></i>
                        <h3 style="
                            font-family: var(--font-primary, 'Cormorant Garamond, serif');
                            color: var(--text-title, #1F1E1C);
                            margin-bottom: 0.5rem;
                            font-size: 1.2rem;
                        ">Aucun produit trouvé</h3>
                        <p style="color: var(--text-subtitle, #7A746B); font-size: 0.9rem;">Essayez de modifier vos filtres</p>
                        <button class="reset-filters-btn-${this.uniqueId}" style="
                            margin-top: 1rem;
                            padding: 0.75rem 1.5rem;
                            background: var(--bg-button, #C6A75E);
                            color: var(--text-button, #FFFFFF);
                            border: none;
                            border-radius: 30px;
                            cursor: pointer;
                            font-size: 0.9rem;
                        ">Réinitialiser</button>
                    </div>

                    <!-- Pagination -->
                    <div class="pagination-${this.uniqueId}" style="
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        gap: 0.5rem;
                        margin-top: 2rem;
                        flex-wrap: wrap;
                    "></div>
                </main>
            </div>
        `;
        
        this.container.appendChild(wrapper);
        
        // Récupérer les éléments
        this.elements = {
            searchInput: this.container.querySelector(`.search-input`),
            mobileFilterToggle: this.container.querySelector(`.mobile-filter-toggle-${this.uniqueId}`),
            mobileFilterHeader: this.container.querySelector(`.mobile-filter-header-${this.uniqueId}`),
            filtersDrawer: this.container.querySelector(`.filters-drawer-${this.uniqueId}`),
            drawerOverlay: this.container.querySelector(`.drawer-overlay-${this.uniqueId}`),
            closeDrawer: this.container.querySelector(`.close-drawer-${this.uniqueId}`),
            categoriesList: this.container.querySelector(`.categories-list-${this.uniqueId}`),
            colorsList: this.container.querySelector(`.colors-list-${this.uniqueId}`),
            variantsList: this.container.querySelector(`.variants-list-${this.uniqueId}`),
            minPrice: this.container.querySelector(`.min-price-${this.uniqueId}`),
            maxPrice: this.container.querySelector(`.max-price-${this.uniqueId}`),
            applyPrice: this.container.querySelector(`.apply-price-${this.uniqueId}`),
            clearFilters: this.container.querySelector(`.clear-filters-${this.uniqueId}`),
            sortSelect: this.container.querySelector(`.sort-select-${this.uniqueId}`),
            productsGrid: this.container.querySelector(`.products-grid-${this.uniqueId}`),
            loadingEl: this.container.querySelector(`.products-loading-${this.uniqueId}`),
            emptyEl: this.container.querySelector(`.products-empty-${this.uniqueId}`),
            resetFiltersBtn: this.container.querySelector(`.reset-filters-btn-${this.uniqueId}`),
            resultsCount: this.container.querySelector(`.results-count-${this.uniqueId} .count`),
            pagination: this.container.querySelector(`.pagination-${this.uniqueId}`),
            filterCount: this.container.querySelector(`.filter-count-${this.uniqueId}`),
            desktopCategoriesList: this.container.querySelector(`.categories-list-desktop-${this.uniqueId}`),
            desktopColorsList: this.container.querySelector(`.colors-list-desktop-${this.uniqueId}`),
            desktopVariantsList: this.container.querySelector(`.variants-list-desktop-${this.uniqueId}`),
            desktopMinPrice: this.container.querySelector(`.min-price-desktop-${this.uniqueId}`),
            desktopMaxPrice: this.container.querySelector(`.max-price-desktop-${this.uniqueId}`),
            desktopApplyPrice: this.container.querySelector(`.apply-price-desktop-${this.uniqueId}`),
            desktopClearFilters: this.container.querySelector(`.clear-filters-desktop-${this.uniqueId}`),
            filterCountHeader: this.container.querySelector(`.filter-count-header-${this.uniqueId}`)
        };
    }

    addStyles() {
        if (document.getElementById(`catalogue-styles-${this.uniqueId}`)) return;
        
        const colors = this.theme.getColors();
        
        const style = document.createElement('style');
        style.id = `catalogue-styles-${this.uniqueId}`;
        style.textContent = `
            /* Desktop styles */
            @media (min-width: 769px) {
                .catalogue-container-${this.uniqueId} {
                    display: flex !important;
                    gap: 2rem;
                    padding: 0 2rem 3rem !important;
                }
                .desktop-sidebar-${this.uniqueId} {
                    display: block !important;
                }
                .mobile-filter-toggle-${this.uniqueId},
                .mobile-filter-header-${this.uniqueId},
                .filters-drawer-${this.uniqueId},
                .drawer-overlay-${this.uniqueId} {
                    display: none !important;
                }
                .products-grid-${this.uniqueId} {
                    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)) !important;
                    gap: 1.5rem !important;
                }
            }

            /* Mobile styles */
            @media (max-width: 768px) {
                .desktop-sidebar-${this.uniqueId} {
                    display: none !important;
                }
                .mobile-filter-toggle-${this.uniqueId} {
                    display: flex !important;
                }
                .mobile-filter-header-${this.uniqueId} {
                    display: flex !important;
                }
                .products-grid-${this.uniqueId} {
                    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
                    gap: 0.68rem !important;
                }
                .product-card-${this.uniqueId} {
                    border-radius: 0.82rem !important;
                    border: 1px solid rgba(198, 167, 94, 0.18) !important;
                    box-shadow: 0 5px 14px rgba(31, 30, 28, 0.07) !important;
                }
                .product-card-${this.uniqueId}:hover {
                    transform: none !important;
                    box-shadow: 0 5px 14px rgba(31, 30, 28, 0.07) !important;
                }
                .product-info-${this.uniqueId} {
                    padding: 0.58rem 0.58rem 0.64rem !important;
                    gap: 0.2rem !important;
                }
                .product-name-${this.uniqueId} {
                    font-size: 0.82rem !important;
                    line-height: 1.28 !important;
                    min-height: auto !important;
                    margin-bottom: 0.12rem !important;
                    -webkit-line-clamp: 2 !important;
                }
                .product-description-${this.uniqueId} {
                    display: none !important;
                }
                .current-price-${this.uniqueId} {
                    font-size: 0.89rem !important;
                }
                .compare-price-${this.uniqueId} {
                    font-size: 0.69rem !important;
                }
                .nav-arrow {
                    opacity: 0.95 !important;
                    width: 24px !important;
                    height: 24px !important;
                    font-size: 0.68rem !important;
                }
                .image-counter {
                    font-size: 0.62rem !important;
                    padding: 0.12rem 0.36rem !important;
                }
                .product-image-container-${this.uniqueId} {
                    aspect-ratio: 0.95 !important;
                }
                .product-price-container-${this.uniqueId} {
                    gap: 0.24rem !important;
                }
                .product-colors-${this.uniqueId} {
                    margin: 0.2rem 0 0 !important;
                    gap: 0.14rem !important;
                }
                .color-dot-${this.uniqueId} {
                    width: 12px !important;
                    height: 12px !important;
                    border-width: 1px !important;
                }
            }

            /* Drawer ouvert */
            .filters-drawer-${this.uniqueId}.open {
                transform: translateX(0) !important;
            }
            .drawer-overlay-${this.uniqueId}.open {
                display: block !important;
                opacity: 1 !important;
            }

            /* Design des cartes produit */
            .product-card-${this.uniqueId} {
                background: var(--bg-card, white);
                border-radius: 0.5rem;
                overflow: hidden;
                transition: all 0.3s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.05);
                cursor: pointer;
                animation: slideIn 0.5s ease forwards;
                opacity: 0;
                height: 100%;
                display: flex;
                flex-direction: column;
            }
            
            .product-card-${this.uniqueId}:hover {
                transform: translateY(-4px);
                box-shadow: 0 10px 25px rgba(0,0,0,0.1);
            }
            
            .product-image-container-${this.uniqueId} {
                position: relative;
                overflow: hidden;
                aspect-ratio: 1;
                background: var(--bg-general, #F5F1E8);
            }
            
            .product-image-container-${this.uniqueId}:hover .nav-arrow {
                opacity: 1;
            }
            
            .product-main-image-${this.uniqueId} {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.5s ease;
            }
            
            .product-card-${this.uniqueId}:hover .product-main-image-${this.uniqueId} {
                transform: scale(1.05);
            }

            .product-badge-${this.uniqueId} {
                position: absolute;
                top: 0.5rem;
                left: 0.5rem;
                z-index: 5;
                background: linear-gradient(135deg, var(--bg-button, #C6A75E), #b89b7b);
                color: var(--text-button, #FFFFFF);
                padding: 0.2rem 0.5rem;
                border-radius: 999px;
                font-size: 0.64rem;
                font-weight: 700;
                letter-spacing: 0.02em;
                box-shadow: 0 4px 12px rgba(0,0,0,0.22);
            }
            
            .nav-arrow {
                opacity: 0;
                transition: opacity 0.3s ease;
                background: rgba(31, 30, 28, 0.7);
                color: var(--text-button, #FFFFFF);
                width: 30px;
                height: 30px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                cursor: pointer;
                z-index: 5;
                font-size: 0.8rem;
            }
            
            .nav-arrow:hover {
                background: var(--bg-button, #C6A75E);
            }
            
            .nav-arrow.left {
                left: 5px;
            }
            
            .nav-arrow.right {
                right: 5px;
            }
            
            .image-counter {
                position: absolute;
                bottom: 5px;
                right: 5px;
                background: rgba(0,0,0,0.6);
                color: var(--text-button, #FFFFFF);
                padding: 2px 6px;
                border-radius: 12px;
                font-size: 0.7rem;
                z-index: 5;
            }
            
            .product-info-${this.uniqueId} {
                padding: 0.75rem;
                flex: 1;
                display: flex;
                flex-direction: column;
            }
            
            .product-name-${this.uniqueId} {
                font-weight: 500;
                color: var(--text-title, #1F1E1C);
                font-size: 0.9rem;
                margin-bottom: 0.25rem;
                line-height: 1.3;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                min-height: 2.05em;
            }
            
            .product-description-${this.uniqueId} {
                color: var(--text-subtitle, #7A746B);
                font-size: 0.75rem;
                margin-bottom: 0.25rem;
                line-height: 1.3;
                display: -webkit-box;
                -webkit-line-clamp: 1;
                -webkit-box-orient: vertical;
                overflow: hidden;
            }
            
            .product-price-container-${this.uniqueId} {
                margin-top: auto;
                display: flex;
                align-items: baseline;
                flex-wrap: wrap;
                gap: 0.3rem;
            }
            
            .current-price-${this.uniqueId} {
                font-size: 1rem;
                font-weight: 700;
                color: var(--text-title, #1F1E1C);
            }
            
            .compare-price-${this.uniqueId} {
                font-size: 0.8rem;
                color: var(--text-subtitle, #7A746B);
                text-decoration: line-through;
            }
            
            .product-colors-${this.uniqueId} {
                display: flex;
                gap: 0.2rem;
                margin: 0.3rem 0;
                flex-wrap: wrap;
            }
            
            .color-dot-${this.uniqueId} {
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 2px solid white;
                box-shadow: 0 0 0 1px var(--text-subtitle, #7A746B)40;
            }
            
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .product-card-${this.uniqueId} {
                animation-delay: calc(var(--index) * 0.05s);
            }
            
            .page-btn-${this.uniqueId} {
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid var(--bg-button, #C6A75E)40;
                background: var(--bg-card, white);
                color: var(--text-title, #1F1E1C);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.3s;
                font-size: 0.9rem;
            }
            .page-btn-${this.uniqueId}:hover:not(:disabled) {
                background: var(--bg-button, #C6A75E)20;
            }
            .page-btn-${this.uniqueId}.active {
                background: var(--bg-button, #C6A75E);
                color: var(--text-button, #FFFFFF);
                border-color: var(--bg-button, #C6A75E);
            }
            .page-btn-${this.uniqueId}:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            
            .color-checkbox-${this.uniqueId} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                cursor: pointer;
                border: 2px solid transparent;
                transition: all 0.2s;
            }
            .color-checkbox-${this.uniqueId}.selected {
                border-color: var(--text-title, #1F1E1C);
                transform: scale(1.1);
            }
            .color-checkbox-${this.uniqueId}:hover {
                transform: scale(1.1);
            }
            .color-checkbox-${this.uniqueId} span {
                width: 24px;
                height: 24px;
                border-radius: 50%;
            }
            
            .categories-list-${this.uniqueId}::-webkit-scrollbar {
                width: 4px;
            }
            .categories-list-${this.uniqueId}::-webkit-scrollbar-track {
                background: var(--bg-general, #F5F1E8);
            }
            .categories-list-${this.uniqueId}::-webkit-scrollbar-thumb {
                background: var(--bg-button, #C6A75E)60;
                border-radius: 4px;
            }
        `;
        document.head.appendChild(style);
    }

    // ... (toutes les méthodes restent identiques : loadProducts, extractCategories, extractColors, etc.)
    // Je ne les recopie pas pour économiser de l'espace mais elles sont inchangées
    
    loadProducts() {
        
        try {
            const collectionRef = collection(db, this.options.collectionName);
            const q = query(collectionRef, limit(this.options.maxRealtimeProducts));
            
            onSnapshot(q, async (snapshot) => {
                
                if (snapshot.empty) {
                    this.state.allProducts = [];
                } else {
                    const rawProducts = snapshot.docs.map(doc => {
                        const data = doc.data();
                        const basePrice = this.toNumber(data.price, 0);
                        const variations = Array.isArray(data.variations) ? data.variations : [];
                        const colors = Array.isArray(data.colors) ? data.colors : [];
                        const images = Array.isArray(data.images) ? data.images : [];
                        const status = typeof data.status === 'string'
                            ? data.status
                            : (data.active === false ? 'draft' : 'active');
                        
                        return {
                            id: doc.id,
                            name: data.name || 'Sans nom',
                            categoryId: data.categoryId || null,
                            categoryName: data.categoryName
                                || (data.categoryId ? this.state.categoryNamesById[data.categoryId] : null)
                                || data.categoryId
                                || 'non-catégorisé',
                            basePrice,
                            price: basePrice,
                            comparePrice: data.comparePrice || null,
                            colors,
                            images,
                            variations,
                            categorySelections: Array.isArray(data.categorySelections) ? data.categorySelections : [],
                            quantity: data.quantity || 0,
                            shortDescription: data.shortDescription || '',
                            longDescription: data.longDescription || '',
                            createdAt: data.createdAt || null,
                            updatedAt: data.updatedAt || null,
                            status,
                            active: data.active !== false,
                            personalization: data.personalization || { enabled: false },
                            sizes: data.sizes || []
                        };
                    });

                    const categoryIds = Array.from(new Set(
                        rawProducts.map(p => p.categoryId).filter(Boolean)
                    ));
                    await this.loadColumnNamesByCategoryIds(categoryIds);

                    this.state.allProducts = rawProducts.map((product) => {
                        const displayPrice = this.getProductDisplayPrice(product);
                        product.price = displayPrice.value;
                        product.displayPriceText = displayPrice.text;
                        product.colorNames = this.getProductColorNames(product);
                        product.variationNames = this.getProductVariationNames(product);
                        product.lineNames = this.getProductStructureNames(product);
                        product.productImages = this.getProductImages(product);

                        this.state.currentImageIndex.set(product.id, 0);
                        return product;
                    }).filter(p => this.isProductVisible(p));
                }
                
                
                this.extractCategories();
                this.extractColors();
                this.extractVariants();
                this.applyFilters();
                
                if (this.elements.loadingEl) this.elements.loadingEl.style.display = 'none';
                
            }, (error) => {
                console.error("❌ Erreur Firebase:", error);
                this.state.allProducts = [];
                this.applyFilters();
                if (this.elements.loadingEl) this.elements.loadingEl.style.display = 'none';
            });

        } catch (error) {
            console.error("❌ Erreur critique:", error);
            this.state.allProducts = [];
            this.applyFilters();
            if (this.elements.loadingEl) this.elements.loadingEl.style.display = 'none';
        }
    }

    extractCategories() {
        const categoriesSet = new Set();
        this.state.allProducts.forEach(product => {
            if (product.categoryName && product.categoryName !== 'non-catégorisé') {
                categoriesSet.add(product.categoryName);
            }
        });
        
        this.state.categories = Array.from(categoriesSet).sort();
        this.renderCategories();
    }

    extractColors() {
        const colorsSet = new Set();
        this.state.allProducts.forEach(product => {
            if (Array.isArray(product.colorNames)) {
                product.colorNames.forEach(colorName => {
                    if (colorName) colorsSet.add(colorName);
                });
            }
        });
        
        this.state.colors = Array.from(colorsSet).sort();
        this.renderColors();
    }
    
    extractVariants() {
        this.renderVariants();

        const selectedCategoryId = this.getSelectedCategoryId();
        if (!selectedCategoryId) {
            this.state.selectedVariants = [];
            return;
        }

        this.loadStructureForCategory(selectedCategoryId).then(() => {
            this.renderVariants();
        });
    }
    
    renderVariants() {
        if (!this.elements.variantsList) return;

        const selectedCategoryId = this.getSelectedCategoryId();
        if (!selectedCategoryId) {
            const emptyHtml = `<div style="font-size:0.8rem;color:var(--text-subtitle, #7A746B);">Sélectionnez une catégorie</div>`;
            this.elements.variantsList.innerHTML = emptyHtml;
            if (this.elements.desktopVariantsList) this.elements.desktopVariantsList.innerHTML = emptyHtml;
            return;
        }

        const structure = this.state.structureByCategoryId[selectedCategoryId] || [];
        if (structure.length === 0) {
            const emptyHtml = `<div style="font-size:0.8rem;color:var(--text-subtitle, #7A746B);">Aucune structure disponible</div>`;
            this.elements.variantsList.innerHTML = emptyHtml;
            if (this.elements.desktopVariantsList) this.elements.desktopVariantsList.innerHTML = emptyHtml;
            return;
        }

        const selectedKey = this.state.selectedVariants[0] || '';
        const renderTreeHtml = () => structure.map((column) => `
            <div style="width:100%; margin-bottom:0.8rem;">
                <div style="font-size:0.85rem; font-weight:600; color:var(--text-title, #1F1E1C); margin-bottom:0.35rem;">
                    ${column.name}
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:0.35rem;">
                    ${column.lines.map((line) => {
                        const lineKey = this.makeLineKey(selectedCategoryId, column.id, line.id);
                        const isSelected = selectedKey === lineKey;
                        return `
                            <button
                                type="button"
                                class="variant-chip-${this.uniqueId} ${isSelected ? 'selected' : ''}"
                                data-line-key="${lineKey}"
                                style="
                                    border: 1px solid ${isSelected ? 'var(--bg-button, #C6A75E)' : 'var(--text-subtitle, #7A746B)40'};
                                    background: ${isSelected ? 'var(--bg-button, #C6A75E)' : 'var(--bg-card, #F5F5F5)'};
                                    color: ${isSelected ? 'var(--text-button, #FFFFFF)' : 'var(--text-body, #4A4A4A)'};
                                    border-radius: 999px;
                                    padding: 0.35rem 0.65rem;
                                    font-size: 0.75rem;
                                    cursor: pointer;
                                "
                            >${line.name}</button>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');

        const html = renderTreeHtml();
        this.elements.variantsList.innerHTML = html;
        if (this.elements.desktopVariantsList) {
            this.elements.desktopVariantsList.innerHTML = html;
        }
        
        const bindVariantClicks = (container) => {
            if (!container) return;
            container.querySelectorAll(`.variant-chip-${this.uniqueId}`).forEach(chip => {
                chip.addEventListener('click', () => {
                    const lineKey = chip.dataset.lineKey;
                    if (!lineKey) return;
                    this.state.selectedVariants = this.state.selectedVariants[0] === lineKey ? [] : [lineKey];
                    
                    this.state.currentPage = 1;
                    this.applyFilters();
                    this.updateActiveFiltersCount();
                    this.renderVariants();
                });
            });
        };
        
        bindVariantClicks(this.elements.variantsList);
        bindVariantClicks(this.elements.desktopVariantsList);
    }

    renderCategories() {
        if (!this.elements.categoriesList) return;
        
        const allCount = this.state.allProducts.length;
        
        let html = `
            <label style="
                display: flex;
                align-items: center;
                gap: 0.5rem;
                cursor: pointer;
                padding: 0.25rem 0;
            ">
                <input type="radio" name="category-${this.uniqueId}" value="all" ${this.state.selectedCategory === 'all' ? 'checked' : ''} style="
                    accent-color: var(--bg-button, #C6A75E);
                    width: 16px;
                    height: 16px;
                    cursor: pointer;
                ">
                <span style="flex: 1; font-size: 0.9rem; color: var(--text-body, #4A4A4A);">Toutes les catégories</span>
                <span class="count" style="
                    color: var(--text-subtitle, #7A746B);
                    font-size: 0.8rem;
                    background: var(--bg-general, #F5F1E8);
                    padding: 0.2rem 0.5rem;
                    border-radius: 12px;
                ">${allCount}</span>
            </label>
        `;
        
        this.state.categories.forEach(category => {
            const count = this.state.allProducts.filter(p => this.matchesSelectedCategory(p, category)).length;
            html += `
                <label style="
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    cursor: pointer;
                    padding: 0.25rem 0;
                ">
                    <input type="radio" name="category-${this.uniqueId}" value="${category}" ${this.state.selectedCategory === category ? 'checked' : ''} style="
                        accent-color: var(--bg-button, #C6A75E);
                        width: 16px;
                        height: 16px;
                        cursor: pointer;
                    ">
                    <span style="flex: 1; font-size: 0.9rem; color: var(--text-body, #4A4A4A);">${category}</span>
                    <span class="count" style="
                        color: var(--text-subtitle, #7A746B);
                        font-size: 0.8rem;
                        background: var(--bg-general, #F5F1E8);
                        padding: 0.2rem 0.5rem;
                        border-radius: 12px;
                    ">${count}</span>
                </label>
            `;
        });
        
        // MOBILE
        this.elements.categoriesList.innerHTML = html;
        
        // DESKTOP
        if (this.elements.desktopCategoriesList) {
            this.elements.desktopCategoriesList.innerHTML = html;
        }
        
        // Event listeners pour MOBILE
        this.elements.categoriesList.querySelectorAll(`input[name="category-${this.uniqueId}"]`).forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.state.selectedCategory = e.target.value;
                this.state.currentPage = 1;
                this.state.selectedVariants = [];
                this.extractVariants();
                this.applyFilters();
                this.updateActiveFiltersCount();
                this.closeDrawer();
            });
        });
        
        // Event listeners pour DESKTOP
        if (this.elements.desktopCategoriesList) {
            this.elements.desktopCategoriesList.querySelectorAll(`input[name="category-${this.uniqueId}"]`).forEach(radio => {
                radio.addEventListener('change', (e) => {
                    this.state.selectedCategory = e.target.value;
                    this.state.currentPage = 1;
                    this.state.selectedVariants = [];
                    this.extractVariants();
                    this.applyFilters();
                    this.updateActiveFiltersCount();
                });
            });
        }
    }

    renderColors() {
        if (!this.elements.colorsList) return;
        
        const colorMap = {
            'rouge': '#FF4444',
            'red': '#FF4444',
            'blue': '#4444FF',
            'bleu': '#4444FF',
            'vert': '#44FF44',
            'green': '#44FF44',
            'jaune': '#FFFF44',
            'yellow': '#FFFF44',
            'noir': '#222222',
            'black': '#222222',
            'blanc': '#FFFFFF',
            'white': '#FFFFFF',
            'gris': '#888888',
            'gray': '#888888',
            'grey': '#888888',
            'marron': '#8B4513',
            'brown': '#8B4513',
            'beige': '#F5F5DC',
            'rose': '#FF99CC',
            'pink': '#FF99CC',
            'violet': '#AA44FF',
            'purple': '#AA44FF',
            'orange': '#FF8844'
        };
        
        let html = '';
        this.state.colors.forEach(colorName => {
            const bgColor = colorMap[colorName.toLowerCase()] || '#CCCCCC';
            const isSelected = this.state.selectedColors.includes(colorName);
            
            html += `
                <div class="color-checkbox-${this.uniqueId} ${isSelected ? 'selected' : ''}" 
                     data-color="${colorName}"
                     style="border-color: ${isSelected ? 'var(--text-title, #1F1E1C)' : 'transparent'};">
                    <span style="background: ${bgColor}; border: 1px solid var(--text-subtitle, #7A746B)40;"></span>
                </div>
            `;
        });
        
        // MOBILE
        this.elements.colorsList.innerHTML = html;
        
        // DESKTOP
        if (this.elements.desktopColorsList) {
            this.elements.desktopColorsList.innerHTML = html;
        }
        
        // Event listeners pour MOBILE
        this.elements.colorsList.querySelectorAll(`.color-checkbox-${this.uniqueId}`).forEach(checkbox => {
            checkbox.addEventListener('click', () => {
                const color = checkbox.dataset.color;
                const index = this.state.selectedColors.indexOf(color);
                
                if (index === -1) {
                    this.state.selectedColors.push(color);
                } else {
                    this.state.selectedColors.splice(index, 1);
                }
                
                this.state.currentPage = 1;
                this.applyFilters();
                this.updateActiveFiltersCount();
                this.renderColors();
            });
        });
        
        // Event listeners pour DESKTOP
        if (this.elements.desktopColorsList) {
            this.elements.desktopColorsList.querySelectorAll(`.color-checkbox-${this.uniqueId}`).forEach(checkbox => {
                checkbox.addEventListener('click', () => {
                    const color = checkbox.dataset.color;
                    const index = this.state.selectedColors.indexOf(color);
                    
                    if (index === -1) {
                        this.state.selectedColors.push(color);
                    } else {
                        this.state.selectedColors.splice(index, 1);
                    }
                    
                    this.state.currentPage = 1;
                    this.applyFilters();
                    this.updateActiveFiltersCount();
                    this.renderColors();
                });
            });
        }
    }

    applyFilters() {
        
        let filtered = [...this.state.allProducts];
        
        if (this.state.selectedCategory !== 'all') {
            filtered = filtered.filter(p => this.matchesSelectedCategory(p, this.state.selectedCategory));
        }
        
        if (this.state.searchQuery) {
            const query = this.state.searchQuery.toLowerCase();
            filtered = filtered.filter(p => 
                p.name.toLowerCase().includes(query) || 
                (p.shortDescription && p.shortDescription.toLowerCase().includes(query))
            );
        }
        
        if (this.state.priceRange.min > 0) {
            filtered = filtered.filter(p => p.price >= this.state.priceRange.min);
        }
        if (this.state.priceRange.max < Infinity) {
            filtered = filtered.filter(p => p.price <= this.state.priceRange.max);
        }
        
        if (this.state.selectedColors.length > 0) {
            filtered = filtered.filter(p => {
                if (!Array.isArray(p.colorNames)) return false;
                return p.colorNames.some(colorName => this.state.selectedColors.includes(colorName));
            });
        }
        
        if (this.state.selectedVariants.length > 0) {
            const activeLine = this.parseLineKey(this.state.selectedVariants[0]);
            filtered = filtered.filter(p => {
                if (!Array.isArray(p.categorySelections)) return false;
                if (activeLine.categoryId && p.categoryId !== activeLine.categoryId) return false;
                return p.categorySelections.some((s) =>
                    s?.columnId === activeLine.columnId && s?.lineId === activeLine.lineId
                );
            });
        }
        
        this.sortProducts(filtered);
        
        this.state.filteredProducts = filtered;
        this.state.totalPages = Math.ceil(filtered.length / this.options.productsPerPage);
        if (this.state.currentPage > this.state.totalPages) {
            this.state.currentPage = 1;
        }
        
        this.paginateProducts();
        this.updateUI();
    }

    sortProducts(products) {
        const [sortField, sortOrder] = this.state.sortBy.split('-');
        
        products.sort((a, b) => {
            let comparison = 0;
            
            switch (sortField) {
                case 'price':
                    comparison = (a.price || 0) - (b.price || 0);
                    break;
                case 'name':
                    comparison = (a.name || '').localeCompare(b.name || '');
                    break;
                case 'createdAt':
                    comparison = new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0);
                    break;
                default:
                    comparison = 0;
            }
            
            return sortOrder === 'asc' ? comparison : -comparison;
        });
    }

    paginateProducts() {
        const start = (this.state.currentPage - 1) * this.options.productsPerPage;
        const end = start + this.options.productsPerPage;
        this.state.displayedProducts = this.state.filteredProducts.slice(start, end);
    }

    updateUI() {
        if (this.elements.resultsCount) {
            this.elements.resultsCount.textContent = this.state.filteredProducts.length;
        }
        
        if (this.state.filteredProducts.length === 0) {
            if (this.elements.productsGrid) this.elements.productsGrid.style.display = 'none';
            if (this.elements.emptyEl) this.elements.emptyEl.style.display = 'block';
        } else {
            if (this.elements.productsGrid) this.elements.productsGrid.style.display = 'grid';
            if (this.elements.emptyEl) this.elements.emptyEl.style.display = 'none';
        }
        
        this.renderProducts();
        this.renderPagination();
    }

    renderProducts() {
        if (!this.elements.productsGrid) return;
        
        this.elements.productsGrid.innerHTML = '';
        
        this.state.displayedProducts.forEach((product, index) => {
            const card = this.createProductCard(product, index);
            this.elements.productsGrid.appendChild(card);
        });
    }

    createProductCard(product, index) {
        const card = document.createElement('div');
        card.className = `product-card-${this.uniqueId}`;
        card.style.setProperty('--index', index);
        card.dataset.productId = product.id;
        
        const images = product.productImages || [];
        const currentIndex = this.state.currentImageIndex.get(product.id) || 0;
        const mainImage = images[currentIndex] || '';
        const hasMultipleImages = images.length > 1;
        const hasDiscount = product.comparePrice && product.comparePrice > product.price;
        
        // Générer les couleurs
        let colorsHtml = '';
        if (product.colorNames && product.colorNames.length > 0) {
            colorsHtml = `<div class="product-colors-${this.uniqueId}">`;
            product.colorNames.slice(0, 3).forEach(colorName => {
                const colorHex = this.getColorHex(colorName);
                colorsHtml += `<div class="color-dot-${this.uniqueId}" style="background: ${colorHex};" title="${colorName}"></div>`;
            });
            if (product.colorNames.length > 3) {
                colorsHtml += `<span style="font-size: 0.6rem; color: var(--text-subtitle, #7A746B); margin-left: 0.1rem;">+${product.colorNames.length-3}</span>`;
            }
            colorsHtml += '</div>';
        }
        
        card.innerHTML = `
            <div class="product-image-container-${this.uniqueId}">
                <img 
                    class="product-main-image-${this.uniqueId}" 
                    src="${this.getImagePath(mainImage)}" 
                    alt="${product.name}"
                    loading="lazy"
                    data-product-id="${product.id}"
                    data-image-index="${currentIndex}"
                    onerror="this.onerror=null; this.src=''; this.parentElement.innerHTML+='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-general, #F5F1E8);color:var(--text-subtitle, #7A746B)30\'><i class=\'fas fa-image\'></i></div>';"
                >
                
                ${hasMultipleImages ? `
                    <div class="nav-arrow left prev-image-${this.uniqueId}" data-product-id="${product.id}">
                        <i class="fas fa-chevron-left"></i>
                    </div>
                    <div class="nav-arrow right next-image-${this.uniqueId}" data-product-id="${product.id}">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                    <div class="image-counter">
                        ${currentIndex + 1}/${images.length}
                    </div>
                ` : ''}
                
                ${hasDiscount ? `<span class="product-badge-${this.uniqueId}">Promo</span>` : ''}
            </div>
            
            <div class="product-info-${this.uniqueId}">
                <h3 class="product-name-${this.uniqueId}">
                    ${product.name}
                </h3>
                
                ${product.shortDescription ? `
                    <p class="product-description-${this.uniqueId}">
                        ${product.shortDescription}
                    </p>
                ` : ''}
                
                ${colorsHtml}
                
                <div class="product-price-container-${this.uniqueId}">
                    <span class="current-price-${this.uniqueId}">
                        ${product.displayPriceText || this.formatPrice(product.price)}
                    </span>
                    ${hasDiscount ? `
                        <span class="compare-price-${this.uniqueId}">
                            ${this.formatPrice(product.comparePrice)}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;

        if (hasMultipleImages) {
            const prevBtn = card.querySelector(`.prev-image-${this.uniqueId}`);
            const nextBtn = card.querySelector(`.next-image-${this.uniqueId}`);
            
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateImage(product.id, 'prev');
            });
            
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.navigateImage(product.id, 'next');
            });
        }

        card.addEventListener('click', (e) => {
            if (e.target.closest(`.prev-image-${this.uniqueId}`) || e.target.closest(`.next-image-${this.uniqueId}`)) {
                return;
            }
            this.openProductModal(product.id);
        });

        return card;
    }

    navigateImage(productId, direction) {
        const product = this.state.allProducts.find(p => p.id === productId);
        const images = product?.productImages || [];
        if (!product || images.length <= 1) return;
        
        let currentIndex = this.state.currentImageIndex.get(productId) || 0;
        
        if (direction === 'prev') {
            currentIndex = (currentIndex - 1 + images.length) % images.length;
        } else {
            currentIndex = (currentIndex + 1) % images.length;
        }
        
        this.state.currentImageIndex.set(productId, currentIndex);
        
        const productCard = this.container.querySelector(`.product-card-${this.uniqueId}[data-product-id="${productId}"]`);
        if (productCard) {
            const img = productCard.querySelector(`.product-main-image-${this.uniqueId}`);
            const counter = productCard.querySelector('.image-counter');
            
            if (img) {
                img.src = this.getImagePath(images[currentIndex]);
                img.dataset.imageIndex = currentIndex;
            }
            
            if (counter) {
                counter.textContent = `${currentIndex + 1}/${images.length}`;
            }
        }
    }

    async openProductModal(productId) {
        try {
            if (!this.ProductModalClass) {
                const module = await import('./product-modal.js');
                this.ProductModalClass = module.default;
            }
            
            if (this.currentModal) {
                await this.currentModal.close();
            }
            
            this.currentModal = new this.ProductModalClass({
                productId: productId,
                collectionName: this.options.collectionName,
                imageBasePath: this.options.imageBasePath,
                onClose: () => {
                    this.currentModal = null;
                    document.body.style.overflow = '';
                }
            });
            
        } catch (error) {
            console.error('❌ Erreur ouverture modal:', error);
        }
    }

    listenForModalEvents() {
        document.addEventListener('openProductModal', (e) => {
            if (e.detail?.productId) {
                this.openProductModal(e.detail.productId);
            }
        });
        
        document.addEventListener('cartUpdated', (e) => {
        });
    }

    getColorHex(colorName) {
        const colorMap = {
            'rouge': '#FF4444',
            'red': '#FF4444',
            'blue': '#4444FF',
            'bleu': '#4444FF',
            'vert': '#44FF44',
            'green': '#44FF44',
            'jaune': '#FFFF44',
            'yellow': '#FFFF44',
            'noir': '#222222',
            'black': '#222222',
            'blanc': '#FFFFFF',
            'white': '#FFFFFF',
            'gris': '#888888',
            'gray': '#888888',
            'grey': '#888888',
            'marron': '#8B4513',
            'brown': '#8B4513',
            'beige': '#F5F5DC',
            'rose': '#FF99CC',
            'pink': '#FF99CC',
            'violet': '#AA44FF',
            'purple': '#AA44FF',
            'orange': '#FF8844'
        };
        return colorMap[colorName?.toLowerCase()] || '#CCCCCC';
    }

    renderPagination() {
        if (!this.elements.pagination) return;
        
        if (this.state.totalPages <= 1) {
            this.elements.pagination.innerHTML = '';
            return;
        }
        
        let html = '';
        
        html += `
            <button class="page-btn-${this.uniqueId} prev" ${this.state.currentPage === 1 ? 'disabled' : ''}>
                <i class="fas fa-chevron-left"></i>
            </button>
        `;
        
        for (let i = 1; i <= this.state.totalPages; i++) {
            if (
                i === 1 || 
                i === this.state.totalPages || 
                (i >= this.state.currentPage - 2 && i <= this.state.currentPage + 2)
            ) {
                html += `
                    <button class="page-btn-${this.uniqueId} ${i === this.state.currentPage ? 'active' : ''}" data-page="${i}">
                        ${i}
                    </button>
                `;
            } else if (i === this.state.currentPage - 3 || i === this.state.currentPage + 3) {
                html += `<span class="page-dots" style="padding: 0 0.3rem; color: var(--text-subtitle, #7A746B);">...</span>`;
            }
        }
        
        html += `
            <button class="page-btn-${this.uniqueId} next" ${this.state.currentPage === this.state.totalPages ? 'disabled' : ''}>
                <i class="fas fa-chevron-right"></i>
            </button>
        `;
        
        this.elements.pagination.innerHTML = html;
        
        this.elements.pagination.querySelectorAll(`.page-btn-${this.uniqueId}[data-page]`).forEach(btn => {
            btn.addEventListener('click', () => {
                this.state.currentPage = parseInt(btn.dataset.page);
                this.paginateProducts();
                this.renderProducts();
                this.renderPagination();
                if (!this.options.isInModal) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
        
        const prevBtn = this.elements.pagination.querySelector(`.page-btn-${this.uniqueId}.prev`);
        const nextBtn = this.elements.pagination.querySelector(`.page-btn-${this.uniqueId}.next`);
        
        if (prevBtn && !prevBtn.disabled) {
            prevBtn.addEventListener('click', () => {
                if (this.state.currentPage > 1) {
                    this.state.currentPage--;
                    this.paginateProducts();
                    this.renderProducts();
                    this.renderPagination();
                    if (!this.options.isInModal) {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }
            });
        }
        
        if (nextBtn && !nextBtn.disabled) {
            nextBtn.addEventListener('click', () => {
                if (this.state.currentPage < this.state.totalPages) {
                    this.state.currentPage++;
                    this.paginateProducts();
                    this.renderProducts();
                    this.renderPagination();
                    if (!this.options.isInModal) {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                }
            });
        }
    }

    updateActiveFiltersCount() {
        let count = 0;
        if (this.state.selectedCategory !== 'all') count++;
        if (this.state.searchQuery) count++;
        if (this.state.priceRange.min > 0 || this.state.priceRange.max < Infinity) count++;
        count += this.state.selectedColors.length;
        count += this.state.selectedVariants.length;
        
        this.state.activeFiltersCount = count;
        
        if (this.elements.filterCount) {
            this.elements.filterCount.textContent = count;
            this.elements.filterCount.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        
        if (this.elements.filterCountHeader) {
            this.elements.filterCountHeader.textContent = count;
            this.elements.filterCountHeader.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        
        if (this.elements.clearFilters) {
            this.elements.clearFilters.style.display = count > 0 ? 'block' : 'none';
        }
        
        if (this.elements.desktopClearFilters) {
            this.elements.desktopClearFilters.style.display = count > 0 ? 'block' : 'none';
        }
    }

    clearAllFilters() {
        this.state.selectedCategory = 'all';
        this.state.searchQuery = '';
        this.state.priceRange = { min: 0, max: Infinity };
        this.state.selectedColors = [];
        this.state.selectedVariants = [];
        this.state.currentPage = 1;
        
        if (this.elements.searchInput) this.elements.searchInput.value = '';
        if (this.elements.minPrice) this.elements.minPrice.value = '';
        if (this.elements.maxPrice) this.elements.maxPrice.value = '';
        
        if (this.elements.desktopMinPrice) this.elements.desktopMinPrice.value = '';
        if (this.elements.desktopMaxPrice) this.elements.desktopMaxPrice.value = '';
        
        this.applyFilters();
        this.updateActiveFiltersCount();
        this.renderCategories();
        this.renderColors();
        this.extractVariants();
        this.closeDrawer();
    }

    setCategoryFilter(categoryName) {
        this.state.selectedCategory = categoryName;
        this.state.currentPage = 1;
        this.state.selectedVariants = [];
        this.extractVariants();
        this.applyFilters();
        this.updateActiveFiltersCount();
        this.renderCategories();
        this.closeDrawer();
    }

    openDrawer() {
        if (this.elements.filtersDrawer) {
            this.elements.filtersDrawer.classList.add('open');
        }
        if (this.elements.drawerOverlay) {
            this.elements.drawerOverlay.classList.add('open');
        }
        document.body.style.overflow = 'hidden';
    }

    closeDrawer() {
        if (this.elements.filtersDrawer) {
            this.elements.filtersDrawer.classList.remove('open');
        }
        if (this.elements.drawerOverlay) {
            this.elements.drawerOverlay.classList.remove('open');
        }
        document.body.style.overflow = '';
    }

    addEventListeners() {
        let searchTimeout;
        if (this.elements.searchInput) {
            this.elements.searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.state.searchQuery = e.target.value;
                    this.state.currentPage = 1;
                    this.applyFilters();
                    this.updateActiveFiltersCount();
                }, 300);
            });
        }
        
        if (this.elements.applyPrice) {
            this.elements.applyPrice.addEventListener('click', () => {
                const min = parseFloat(this.elements.minPrice.value) || 0;
                const max = parseFloat(this.elements.maxPrice.value) || Infinity;
                
                this.state.priceRange = { min, max };
                this.state.currentPage = 1;
                this.applyFilters();
                this.updateActiveFiltersCount();
                this.closeDrawer();
            });
        }
        
        if (this.elements.sortSelect) {
            this.elements.sortSelect.addEventListener('change', (e) => {
                this.state.sortBy = e.target.value;
                this.state.currentPage = 1;
                this.applyFilters();
            });
        }
        
        if (this.elements.clearFilters) {
            this.elements.clearFilters.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
        
        if (this.elements.resetFiltersBtn) {
            this.elements.resetFiltersBtn.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
        
        if (this.elements.mobileFilterToggle) {
            this.elements.mobileFilterToggle.addEventListener('click', () => {
                this.openDrawer();
            });
        }
        
        if (this.elements.mobileFilterHeader) {
            this.elements.mobileFilterHeader.addEventListener('click', () => {
                this.openDrawer();
            });
        }
        
        if (this.elements.closeDrawer) {
            this.elements.closeDrawer.addEventListener('click', () => {
                this.closeDrawer();
            });
        }
        
        if (this.elements.drawerOverlay) {
            this.elements.drawerOverlay.addEventListener('click', () => {
                this.closeDrawer();
            });
        }
        
        if (this.elements.desktopApplyPrice) {
            this.elements.desktopApplyPrice.addEventListener('click', () => {
                const min = parseFloat(this.elements.desktopMinPrice.value) || 0;
                const max = parseFloat(this.elements.desktopMaxPrice.value) || Infinity;
                
                this.state.priceRange = { min, max };
                this.state.currentPage = 1;
                this.applyFilters();
                this.updateActiveFiltersCount();
            });
        }
        
        if (this.elements.desktopClearFilters) {
            this.elements.desktopClearFilters.addEventListener('click', () => {
                this.clearAllFilters();
            });
        }
        
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                this.closeDrawer();
            }
        });
    }

    destroy() {
        if (this.unsubscribeTheme) {
            this.unsubscribeTheme();
        }
        if (this.container) {
            this.container.innerHTML = '';
        }
        if (this.currentModal) {
            this.currentModal.close();
        }
    }
}

export default CategoriesSection;
window.CategoriesSection = CategoriesSection;
