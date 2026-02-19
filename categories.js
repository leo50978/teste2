// ================= CATEGORIES.JS FINAL AVEC INTÉGRATION CATALOGUE =================
// VERSION CORRIGÉE - UTILISE LES IMAGES PRINCIPALES

import { db } from './firebase-init.js';
import { collection, query, onSnapshot } 
from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

// Importer le composant catalogue
import CategoriesSection from './categories-section.js';

class CategoriesDisplay {

    constructor(containerId) {

        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error("❌ Container introuvable");
            return;
        }

        this.collectionName = "categories_list";
        this.items = [];
        this.rawCategories = [];
        this.firstProductImageByCategoryId = new Map();
        this.catalogueInstance = null;
        this.catalogueContainer = null;
        this.categoryObserver = null;

        // Créer le conteneur pour le catalogue (modal)
        this.createCatalogueContainer();

        this.init();
    }

    createCatalogueContainer() {
        // Vérifier si le conteneur existe déjà
        this.catalogueContainer = document.getElementById('catalogue-modal-container');
        
        if (!this.catalogueContainer) {
            this.catalogueContainer = document.createElement('div');
            this.catalogueContainer.id = 'catalogue-modal-container';
            this.catalogueContainer.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: white;
                z-index: 9999;
                overflow-y: auto;
                display: none;
                opacity: 0;
                transition: opacity 0.3s ease;
            `;
            
            // Ajouter un bouton de fermeture
            this.catalogueContainer.innerHTML = `
                <div style="
                    position: sticky;
                    top: 0;
                    background: white;
                    z-index: 100;
                    border-bottom: 1px solid rgba(198,167,94,0.2);
                    padding: 1rem 2rem;
                    display: flex;
                    justify-content: flex-end;
                    align-items: center;
                ">
                    <button class="close-catalogue-btn" style="
                        background: none;
                        border: none;
                        font-size: 1.8rem;
                        cursor: pointer;
                        color: #7A746B;
                        width: 48px;
                        height: 48px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border-radius: 50%;
                        transition: all 0.3s;
                    ">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="catalogue-content"></div>
            `;
            
            document.body.appendChild(this.catalogueContainer);
            
            // Ajouter l'événement de fermeture
            const closeBtn = this.catalogueContainer.querySelector('.close-catalogue-btn');
            closeBtn.addEventListener('click', () => this.closeCatalogue());
            
            // Fermer avec la touche Echap
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.catalogueContainer.style.display === 'block') {
                    this.closeCatalogue();
                }
            });
        }
    }

    init() {
        this.renderBase();
        this.loadData();
        this.bindMenuOpenEvents();
    }

    bindMenuOpenEvents() {
        document.addEventListener('openCategorySectionFromMenu', (event) => {
            const detail = event?.detail || {};
            this.openCatalogueFromMenu(detail);
        });
    }

    renderBase() {
        this.container.innerHTML = `
            <div class="categories-wrapper">
                <div class="categories-grid"></div>
            </div>
        `;

        this.grid = this.container.querySelector(".categories-grid");

        // Injecter le style premium une seule fois
        if (!document.getElementById("ultra-categories-style")) {
            const style = document.createElement("style");
            style.id = "ultra-categories-style";
            style.textContent = `
                .categories-wrapper {
                    max-width: 1400px;
                    margin: auto;
                    padding: 1.5rem;
                }

                .categories-grid {
                    display: grid;
                    gap: 1.2rem;
                    grid-template-columns: repeat(2, 1fr);
                }

                /* Tablet */
                @media (min-width: 640px) {
                    .categories-grid {
                        grid-template-columns: repeat(3, 1fr);
                    }
                }

                /* Laptop */
                @media (min-width: 1024px) {
                    .categories-grid {
                        grid-template-columns: repeat(4, 1fr);
                    }
                }

                /* Large screen */
                @media (min-width: 1440px) {
                    .categories-grid {
                        grid-template-columns: repeat(5, 1fr);
                    }
                }

                .category-card {
                    background: white;
                    border-radius: 18px;
                    overflow: hidden;
                    cursor: pointer;
                    transition:
                        opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
                        transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
                        box-shadow 0.4s ease;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.04);
                }

                .category-card.scroll-hidden {
                    opacity: 0;
                    transform: translateY(28px) scale(0.98);
                }

                .category-card.scroll-visible {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }

                .category-card:hover {
                    transform: translateY(-8px);
                    box-shadow: 0 20px 35px rgba(0,0,0,0.12);
                }

                .category-image-container {
                    width: 100%;
                    aspect-ratio: 1 / 1;
                    overflow: hidden;
                    position: relative;
                }

                .category-image {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    transition: transform 0.6s ease;
                }

                .category-card:hover .category-image {
                    transform: scale(1.08);
                }

                .category-overlay {
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(to top, rgba(0,0,0,0.4), transparent);
                    opacity: 0;
                    transition: opacity 0.4s ease;
                }

                .category-card:hover .category-overlay {
                    opacity: 1;
                }

                .category-name {
                    padding: 1rem;
                    text-align: center;
                    font-size: 1rem;
                    font-weight: 500;
                    letter-spacing: 0.5px;
                    color: #111;
                    background: white;
                }
            `;
            document.head.appendChild(style);
        }
    }

    loadData() {
        const categoriesRef = collection(db, this.collectionName);
        const categoriesQuery = query(categoriesRef);
        const productsRef = collection(db, "products");
        const productsQuery = query(productsRef);

        onSnapshot(categoriesQuery, (snapshot) => {
            this.rawCategories = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data()
            }));
            this.buildItems();
        }, (error) => {
            console.error("❌ Erreur Firebase catégories :", error);
        });

        onSnapshot(productsQuery, (snapshot) => {
            this.firstProductImageByCategoryId.clear();

            snapshot.forEach((doc) => {
                const data = doc.data();
                const firstImage = this.getFirstProductImage(data);
                if (!firstImage) return;

                if (data?.categoryId && !this.firstProductImageByCategoryId.has(data.categoryId)) {
                    this.firstProductImageByCategoryId.set(data.categoryId, firstImage);
                }
            });

            this.buildItems();
        }, (error) => {
            console.error("❌ Erreur Firebase produits :", error);
        });
    }

    getFirstProductImage(productData) {
        if (!Array.isArray(productData?.images)) return "";
        const firstValid = productData.images.find((img) => typeof img === "string" && img.trim() !== "");
        return firstValid || "";
    }

    resolveImagePath(imageValue) {
        if (typeof imageValue !== "string") return "";
        const trimmed = imageValue.trim();
        if (!trimmed) return "";
        if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("data:") || trimmed.startsWith("./") || trimmed.startsWith("/")) {
            return trimmed;
        }
        return `./${trimmed}`;
    }

    buildItems() {
        this.items = [];

        this.rawCategories.forEach((category) => {
            const categoryName = category?.name || "";
            if (!categoryName) return;

            const imageFromCategory = this.resolveImagePath(category?.image || "");
            const imageFromProducts = this.resolveImagePath(
                this.firstProductImageByCategoryId.get(category.id) || ""
            );

            this.items.push({
                id: category.id,
                name: categoryName,
                // Priorité: image définie sur la catégorie (dashboard), puis fallback produit
                image: imageFromCategory || imageFromProducts
            });
        });

        this.renderCategories();
    }

    renderCategories() {
        this.grid.innerHTML = "";
        this.disconnectCategoryObserver();

        if (this.items.length === 0) {
            this.grid.innerHTML = "<p>Aucune catégorie trouvée</p>";
            return;
        }

        this.items.forEach((item, index) => {
            const card = this.createCategoryCard(item, index);
            this.grid.appendChild(card);
        });

        this.setupCategoryScrollAnimation();
    }

    createCategoryCard(item, index) {
        const card = document.createElement("div");
        card.className = "category-card scroll-hidden";
        card.style.transitionDelay = `${Math.min(index * 110, 660)}ms`;
        card.dataset.categoryName = item.name;
        card.dataset.categoryId = item.id;
        const imageHtml = item.image
            ? `<img src="${item.image}" class="category-image" loading="lazy" onerror="this.remove();">`
            : `<div class="category-image" style="display:flex;align-items:center;justify-content:center;background:#f4f4f4;color:#9b9b9b;"><i class="fas fa-image"></i></div>`;

        card.innerHTML = `
            <div class="category-image-container">
                ${imageHtml}
                <div class="category-overlay"></div>
            </div>
            <div class="category-name">
                ${item.name}
            </div>
        `;

        // Ajouter l'événement de clic pour ouvrir le catalogue
        card.addEventListener('click', () => {
            this.openCatalogue(item.name);
        });

        return card;
    }

    disconnectCategoryObserver() {
        if (this.categoryObserver) {
            this.categoryObserver.disconnect();
            this.categoryObserver = null;
        }
    }

    setupCategoryScrollAnimation() {
        const cards = this.grid.querySelectorAll('.category-card');
        if (!cards.length) return;

        const revealCard = (card) => {
            card.classList.remove('scroll-hidden');
            card.classList.add('scroll-visible');
        };

        if (!('IntersectionObserver' in window)) {
            cards.forEach(revealCard);
            return;
        }

        this.categoryObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                revealCard(entry.target);
                this.categoryObserver.unobserve(entry.target);
            });
        }, {
            threshold: 0.18,
            rootMargin: '0px 0px -8% 0px'
        });

        cards.forEach((card) => this.categoryObserver.observe(card));
    }

    openCatalogue(categoryName) {
        
        // Afficher la modal
        this.catalogueContainer.style.display = 'block';
        
        // Animation d'apparition
        setTimeout(() => {
            this.catalogueContainer.style.opacity = '1';
        }, 50);
        
        // Empêcher le scroll du body
        document.body.style.overflow = 'hidden';
        
        // Conteneur pour le catalogue (dans la modal)
        const catalogueContent = this.catalogueContainer.querySelector('.catalogue-content');
        catalogueContent.innerHTML = ''; // Vider le contenu précédent
        
        // Créer un conteneur spécifique pour cette instance
        const catalogueInstanceContainer = document.createElement('div');
        catalogueInstanceContainer.id = 'catalogue-instance-' + Date.now();
        catalogueContent.appendChild(catalogueInstanceContainer);
        
        // Initialiser ou réinitialiser le catalogue
        setTimeout(() => {
            // Détruire l'ancienne instance si elle existe
            if (this.catalogueInstance && this.catalogueInstance.destroy) {
                this.catalogueInstance.destroy();
            }
            
            // Créer une nouvelle instance du catalogue avec l'option useMainImage
            try {
                this.catalogueInstance = new CategoriesSection(catalogueInstanceContainer.id, {
                    collectionName: 'products', // Collection des produits
                    productsPerPage: 12,
                    initialCategory: categoryName,
                    isInModal: true, // Pour adapter le style (pas de header avec titre)
                    useMainImage: true // 🔥 NOUVEAU : Forcer l'utilisation de l'image principale
                });
            } catch (error) {
                console.error("❌ Erreur initialisation catalogue:", error);
                catalogueContent.innerHTML = `
                    <div style="text-align: center; padding: 4rem; color: #7F1D1D;">
                        <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
                        <p>Erreur lors de l'ouverture du catalogue</p>
                        <button onclick="document.getElementById('catalogue-modal-container').style.display='none'" 
                                style="margin-top:1rem; padding:0.5rem 1rem; background:#C6A75E; border:none; border-radius:8px; cursor:pointer;">
                            Fermer
                        </button>
                    </div>
                `;
            }
        }, 100);
    }

    openCatalogueFromMenu({ categoryId, categoryName, columnId, lineId, openFilters = true }) {
        const initialCategory = categoryName || categoryId || 'all';
        const initialLineKey = (categoryId && columnId && lineId) ? `${categoryId}::${columnId}::${lineId}` : '';

        // Afficher la modal
        this.catalogueContainer.style.display = 'block';
        setTimeout(() => {
            this.catalogueContainer.style.opacity = '1';
        }, 50);
        document.body.style.overflow = 'hidden';

        const catalogueContent = this.catalogueContainer.querySelector('.catalogue-content');
        catalogueContent.innerHTML = '';

        const catalogueInstanceContainer = document.createElement('div');
        catalogueInstanceContainer.id = 'catalogue-instance-' + Date.now();
        catalogueContent.appendChild(catalogueInstanceContainer);

        setTimeout(() => {
            if (this.catalogueInstance && this.catalogueInstance.destroy) {
                this.catalogueInstance.destroy();
            }

            try {
                this.catalogueInstance = new CategoriesSection(catalogueInstanceContainer.id, {
                    collectionName: 'products',
                    productsPerPage: 12,
                    initialCategory,
                    initialLineKey,
                    openFiltersOnInit: openFilters === true,
                    isInModal: true,
                    useMainImage: true
                });
            } catch (error) {
                console.error("❌ Erreur initialisation catalogue depuis menu:", error);
            }
        }, 100);
    }

    closeCatalogue() {
        
        // Animation de fermeture
        this.catalogueContainer.style.opacity = '0';
        
        setTimeout(() => {
            this.catalogueContainer.style.display = 'none';
            
            // Nettoyer l'instance du catalogue
            if (this.catalogueInstance && this.catalogueInstance.destroy) {
                this.catalogueInstance.destroy();
                this.catalogueInstance = null;
            }
            
            // Réactiver le scroll du body
            document.body.style.overflow = '';
        }, 300);
    }

    destroy() {
        this.disconnectCategoryObserver();
    }
}

export default CategoriesDisplay;
window.CategoriesDisplay = CategoriesDisplay;

