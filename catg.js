// ============= CATG.JS - Affichage des catégories depuis categories_list =============

// Import des couleurs et polices depuis :root
const rootStyles = getComputedStyle(document.documentElement);

const colors = {
    primary: rootStyles.getPropertyValue('--primary').trim() || '#2C2A29',
    secondary: rootStyles.getPropertyValue('--secondary').trim() || '#C6A75E',
    accent: rootStyles.getPropertyValue('--accent').trim() || '#7A746B',
    luxury: rootStyles.getPropertyValue('--luxury').trim() || '#1F1E1C',
    ivory: rootStyles.getPropertyValue('--ivory').trim() || '#F5F1E8'
};

const fonts = {
    primary: "'Cormorant Garamond', serif",
    secondary: "'Manrope', sans-serif"
};

// Import Firebase
import { db } from './firebase-init.js';
import { collection, onSnapshot, query, orderBy } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class Catg {
    constructor(containerId, options = {}) {
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`❌ Container #${containerId} non trouvé`);
            return;
        }

        this.options = {
            collectionName: 'categories_list',
            imagePath: options.imagePath || './',
            title: options.title || 'Nos univers',
            ...options
        };
        

        this.categories = [];
        this.init();
    }

    init() {
        this.renderStructure();
        this.addStyles();
        this.loadCategories();
    }

    renderStructure() {
        this.container.innerHTML = '';
        
        const wrapper = document.createElement('div');
        wrapper.className = 'catg-wrapper';
        wrapper.style.cssText = `
            width: 100%;
            font-family: ${fonts.secondary};
            padding: 2rem 1rem;
        `;
        
        wrapper.innerHTML = `
            <div class="catg-header" style="
                text-align: center;
                margin-bottom: 2rem;
                padding: 1rem;
            ">
                <h2 class="catg-title" style="
                    font-family: ${fonts.primary};
                    font-size: clamp(1.8rem, 5vw, 2.5rem);
                    font-weight: 600;
                    color: ${colors.luxury};
                    margin-bottom: 0.5rem;
                ">${this.options.title}</h2>
                <div class="catg-separator" style="
                    width: 60px;
                    height: 2px;
                    background: ${colors.secondary};
                    margin: 0.5rem auto;
                "></div>
            </div>

            <!-- Grille responsive : 2 colonnes sur mobile, plus sur desktop -->
            <div class="catg-grid" style="
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 1rem;
                max-width: 1400px;
                margin: 0 auto;
            "></div>

            <!-- Loading -->
            <div class="catg-loading" style="
                text-align: center;
                padding: 3rem;
                color: ${colors.accent};
                display: block;
            ">
                <i class="fas fa-spinner fa-spin fa-2x" style="color: ${colors.secondary};"></i>
                <p style="margin-top: 1rem;">Chargement des catégories...</p>
            </div>

            <!-- Empty state -->
            <div class="catg-empty" style="
                display: none;
                text-align: center;
                padding: 3rem;
                color: ${colors.accent};
                background: white;
                border-radius: 12px;
                border: 1px solid ${colors.secondary}20;
            ">
                <i class="fas fa-tags fa-2x mb-3" style="opacity: 0.5; color: ${colors.secondary};"></i>
                <p>Aucune catégorie disponible</p>
            </div>
        `;
        
        this.container.appendChild(wrapper);
        
        this.grid = wrapper.querySelector('.catg-grid');
        this.loadingEl = wrapper.querySelector('.catg-loading');
        this.emptyEl = wrapper.querySelector('.catg-empty');
        this.titleEl = wrapper.querySelector('.catg-title');
    }

    addStyles() {
        if (document.getElementById('catg-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'catg-styles';
        style.textContent = `
            /* Responsive grid : 2 -> 3 -> 4 colonnes selon la largeur */
            @media (min-width: 640px) {
                .catg-grid {
                    grid-template-columns: repeat(3, 1fr) !important;
                    gap: 1.25rem !important;
                }
            }
            @media (min-width: 1024px) {
                .catg-grid {
                    grid-template-columns: repeat(4, 1fr) !important;
                    gap: 1.5rem !important;
                }
            }
            @media (min-width: 1280px) {
                .catg-grid {
                    grid-template-columns: repeat(5, 1fr) !important;
                }
            }
            
            /* Cards */
            .catg-card {
                display: block;
                text-decoration: none;
                background: white;
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.03);
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                border: 1px solid ${colors.secondary}20;
                cursor: pointer;
                height: 100%;
                position: relative;
            }
            
            .catg-card:hover {
                transform: translateY(-8px);
                box-shadow: 0 20px 30px -10px rgba(0,0,0,0.15);
                border-color: ${colors.secondary}60;
            }
            
            .catg-card:hover .catg-image {
                transform: scale(1.08);
            }
            
            .catg-image-container {
                width: 100%;
                aspect-ratio: 1/1;
                overflow: hidden;
                background: linear-gradient(135deg, ${colors.ivory} 0%, #ffffff 100%);
                position: relative;
            }
            
            .catg-image-container::after {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.03) 100%);
                pointer-events: none;
            }
            
            .catg-image {
                width: 100%;
                height: 100%;
                object-fit: cover;
                transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            .catg-name {
                padding: 1rem 0.75rem;
                text-align: center;
                font-size: 1rem;
                font-weight: 500;
                color: ${colors.luxury};
                border-top: 1px solid ${colors.secondary}30;
                background: white;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                letter-spacing: 0.3px;
                position: relative;
            }
            
            .catg-name::before {
                content: '';
                position: absolute;
                top: -1px;
                left: 50%;
                transform: translateX(-50%);
                width: 30px;
                height: 2px;
                background: ${colors.secondary};
                opacity: 0;
                transition: opacity 0.3s ease;
            }
            
            .catg-card:hover .catg-name::before {
                opacity: 1;
            }
            
            /* Badge description optionnel */
            .catg-description {
                font-size: 0.8rem;
                color: ${colors.accent};
                margin-top: 0.25rem;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                opacity: 0.8;
            }
            
            /* Animations */
            @keyframes catgFadeInUp {
                from {
                    opacity: 0;
                    transform: translateY(30px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .catg-card {
                animation: catgFadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
                opacity: 0;
            }
            
            /* Animation delays */
            .catg-card:nth-child(1) { animation-delay: 0.1s; }
            .catg-card:nth-child(2) { animation-delay: 0.15s; }
            .catg-card:nth-child(3) { animation-delay: 0.2s; }
            .catg-card:nth-child(4) { animation-delay: 0.25s; }
            .catg-card:nth-child(5) { animation-delay: 0.3s; }
            .catg-card:nth-child(6) { animation-delay: 0.35s; }
            .catg-card:nth-child(7) { animation-delay: 0.4s; }
            .catg-card:nth-child(8) { animation-delay: 0.45s; }
            .catg-card:nth-child(9) { animation-delay: 0.5s; }
            .catg-card:nth-child(10) { animation-delay: 0.55s; }
        `;
        document.head.appendChild(style);
    }

    loadCategories() {
        
        try {
            const collectionRef = collection(db, this.options.collectionName);
            // Trier par ordre si disponible, sinon par nom
            const q = query(collectionRef);
            
            onSnapshot(q, (snapshot) => {
                
                if (snapshot.empty) {
                    this.categories = [];
                } else {
                    this.categories = snapshot.docs.map(doc => {
                        const data = doc.data();
                        
                        return {
                            id: doc.id,
                            name: data.name || 'Sans nom',
                            image: data.image || 'default.jpg',
                            description: data.description || '',
                            showInHeader: data.showInHeader || false,
                            createdAt: data.createdAt || null,
                            updatedAt: data.updatedAt || null
                        };
                    });
                    
                    // Optionnel: filtrer pour n'afficher que celles avec showInHeader = true
                    // this.categories = this.categories.filter(cat => cat.showInHeader);
                    
                }
                
                // Masquer loading
                if (this.loadingEl) this.loadingEl.style.display = 'none';
                
                // Afficher les catégories
                this.renderCategories();
                
            }, (error) => {
                console.error("❌ Erreur Firebase:", error);
                if (this.loadingEl) this.loadingEl.style.display = 'none';
                this.showEmpty();
            });

        } catch (error) {
            console.error("❌ Erreur critique:", error);
            if (this.loadingEl) this.loadingEl.style.display = 'none';
            this.showEmpty();
        }
    }

    showEmpty() {
        if (this.emptyEl) {
            this.emptyEl.style.display = 'block';
        }
        if (this.grid) {
            this.grid.style.display = 'none';
        }
    }

    renderCategories() {
        if (!this.grid) return;
        
        this.grid.innerHTML = '';
        
        if (this.categories.length === 0) {
            this.showEmpty();
            return;
        }
        
        this.grid.style.display = 'grid';
        if (this.emptyEl) this.emptyEl.style.display = 'none';
        
        this.categories.forEach((category) => {
            const card = this.createCard(category);
            this.grid.appendChild(card);
        });
        
    }

    createCard(category) {
        const card = document.createElement('div');
        card.className = 'catg-card';
        card.dataset.categoryId = category.id;
        
        const imageSrc = category.image || 'default.jpg';
        const fullImagePath = this.options.imagePath + imageSrc;
        
        card.innerHTML = `
            <div class="catg-image-container">
                <img 
                    class="catg-image" 
                    src="${fullImagePath}" 
                    alt="${category.name}"
                    loading="lazy"
                    onerror="this.onerror=null; this.src='https://via.placeholder.com/400x400/${colors.luxury.slice(1)}/ffffff?text=${encodeURIComponent(category.name.charAt(0))}';"
                >
            </div>
            <div class="catg-name">
                ${category.name}
                ${category.description ? `<div class="catg-description">${category.description}</div>` : ''}
            </div>
        `;

        // Au clic, émettre un événement avec le nom de la catégorie
        card.addEventListener('click', (e) => {
            e.preventDefault();
            
            const event = new CustomEvent('categorySelected', {
                detail: { 
                    categoryName: category.name,
                    categoryId: category.id,
                    category: category
                },
                bubbles: true,
                composed: true
            });
            document.dispatchEvent(event);
        });

        return card;
    }

    // Méthode publique pour recharger les catégories
    reload() {
        if (this.loadingEl) this.loadingEl.style.display = 'block';
        this.loadCategories();
    }

    // Méthode publique pour mettre à jour le titre
    setTitle(newTitle) {
        this.options.title = newTitle;
        if (this.titleEl) {
            this.titleEl.textContent = newTitle;
        }
    }
}

export default Catg;
window.Catg = Catg;
