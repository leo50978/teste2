// ============= MEGA-MENU.JS - VERSION AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { collection, getDocs, query, orderBy, where, limit } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import CategoriesSection from './categories-section.js';

class MegaMenu {
  constructor() {
    this.categoriesSectionClass = CategoriesSection;
    this.menuElement = document.getElementById('megaPortalLux21');
    this.closeBtn = document.getElementById('megaCloseBtn');
    this.columnsContainer = document.getElementById('megaColumnsContainer');
    this.featuredContainer = document.getElementById('featuredProductsGrid');
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = theme.subscribe(() => {
      this.applyTheme();
    });
    
    this.init();
  }

  formatPriceHTG(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }
  
  applyTheme() {
    if (!this.menuElement) return;
    
    const colors = theme.getColors();
    const typography = theme.getTypography();
    const fonts = theme.getFonts();
    
    // Appliquer les couleurs via des variables CSS ou directement
    const style = document.createElement('style');
    style.id = 'mega-menu-theme-styles';
    
    // Supprimer l'ancien style s'il existe
    const oldStyle = document.getElementById('mega-menu-theme-styles');
    if (oldStyle) oldStyle.remove();
    
    style.textContent = `
      #megaPortalLux21 {
        background: ${colors?.background?.card || 'rgba(255,255,255,0.98)'};
        backdrop-filter: blur(16px);
      }
      
      .mega-close-btn {
        background: ${colors?.background?.card || 'white'};
        border-color: ${colors?.icon?.standard || '#C6A75E'};
        color: ${colors?.icon?.standard || '#C6A75E'};
      }
      
      .mega-close-btn:hover {
        background: ${colors?.icon?.hover || '#C6A75E'};
        color: ${colors?.text?.button || '#FFFFFF'};
      }
      
      .mega-column-title {
        font-family: ${typography?.family || fonts?.primary || "'Cormorant Garamond', serif"};
        color: ${colors?.text?.title || '#1F1E1C'};
        border-bottom-color: ${colors?.icon?.standard || '#C6A75E'};
      }
      
      .mega-line {
        color: ${colors?.text?.body || '#4A4A4A'};
        font-family: ${fonts?.secondary || "'Manrope', sans-serif"};
      }
      
      .mega-line:hover {
        background: ${colors?.icon?.hover ? colors.icon.hover + '20' : 'rgba(198,167,94,0.1)'};
        color: ${colors?.text?.title || '#1F1E1C'};
      }
      
      .mega-featured-products {
        background: ${colors?.background?.general ? colors.background.general + '10' : 'rgba(184,155,123,0.06)'};
      }
      
      .mega-featured-products h3 {
        font-family: ${typography?.family || fonts?.primary || "'Cormorant Garamond', serif"};
        color: ${colors?.text?.title || '#1F1E1C'};
      }
      
      .featured-card {
        background: ${colors?.background?.card || 'white'};
        border: 1px solid ${colors?.icon?.standard ? colors.icon.standard + '20' : 'rgba(184,155,123,0.1)'};
        color: ${colors?.text?.body || '#4A4A4A'};
        border-radius: 18px;
        padding: 0.65rem;
        display: grid;
        grid-template-columns: 92px 1fr;
        gap: 0.85rem;
        align-items: center;
        transition: transform 0.28s ease, box-shadow 0.28s ease, border-color 0.28s ease;
        position: relative;
        overflow: hidden;
      }
      
      .featured-card:hover {
        border-color: ${colors?.icon?.hover || 'rgba(184,155,123,0.2)'};
        box-shadow: 0 16px 32px ${colors?.icon?.hover ? colors.icon.hover + '20' : 'rgba(58,78,63,0.08)'};
        transform: translateY(-3px);
      }

      .featured-media {
        width: 92px;
        height: 92px;
        border-radius: 14px;
        object-fit: cover;
        border: 1px solid ${colors?.icon?.standard ? colors.icon.standard + '25' : 'rgba(184,155,123,0.2)'};
      }

      .featured-content {
        min-width: 0;
        display: grid;
        gap: 0.35rem;
      }

      .featured-desc {
        font-size: 0.79rem;
        line-height: 1.38;
        color: ${colors?.text?.body || '#666'};
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .featured-prices {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        flex-wrap: wrap;
      }

      .featured-price {
        font-size: 0.98rem;
        font-weight: 700;
        color: ${colors?.text?.title || '#1F1E1C'};
      }

      .featured-old-price {
        font-size: 0.76rem;
        color: ${colors?.text?.body || '#999'};
        text-decoration: line-through;
      }

      .featured-chip {
        position: absolute;
        top: 0.55rem;
        left: 0.55rem;
        font-size: 0.61rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        padding: 0.22rem 0.42rem;
        border-radius: 999px;
        background: ${colors?.icon?.hover || '#C6A75E'};
        color: ${colors?.text?.button || '#fff'};
      }

      @media (max-width: 1024px) {
        .featured-card {
          grid-template-columns: 78px 1fr;
          padding: 0.56rem;
          border-radius: 14px;
          gap: 0.68rem;
        }
        .featured-media {
          width: 78px;
          height: 78px;
          border-radius: 11px;
        }
      }
      
      .featured-card h4 {
        font-family: ${typography?.family || fonts?.primary || "'Cormorant Garamond', serif"};
        color: ${colors?.text?.title || '#1F1E1C'};
      }
      
      .featured-card p {
        color: ${colors?.text?.body || '#666'};
      }
      
      .featured-card span:first-of-type {
        color: ${colors?.text?.title || '#1F1E1C'};
      }
      
      .featured-card span:last-of-type {
        color: ${colors?.text?.body || '#999'};
      }
    `;
    
    document.head.appendChild(style);
  }
  
  init() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }
    
    // Appliquer le thème initial
    this.applyTheme();
    
    // Fermer au clic en dehors
    document.addEventListener('click', (e) => {
      if (this.menuElement && 
          this.menuElement.style.display === 'block' && 
          !e.target.closest('.categoryTriggerLux77') && 
          !e.target.closest('#megaPortalLux21')) {
        this.close();
      }
    });
  }
  
  async open(categoryId) {
    if (!this.menuElement) return;
    
    this.menuElement.style.display = 'block';
    this.menuElement.classList.add('is-open');
    
    await Promise.all([
      this.loadColumns(categoryId),
      this.loadRecentProducts(categoryId)
    ]);
    
    setTimeout(() => {
      this.menuElement.style.opacity = '1';
    }, 50);
  }
  
  getCategoryName(categoryId) {
    // Récupérer le nom de la catégorie depuis l'élément HTML
    const trigger = document.querySelector(`.categoryTriggerLux77[data-category-id="${categoryId}"]`);
    return trigger ? trigger.textContent : null;
  }
  
  close() {
    if (!this.menuElement) return;
    
    this.menuElement.style.opacity = '0';
    this.menuElement.classList.remove('is-open');
    setTimeout(() => {
      this.menuElement.style.display = 'none';
    }, 400);
  }
  
  async loadColumns(categoryId) {
    try {
      const columnsRef = collection(db, 'categories_list', categoryId, 'columns');
      const q = query(columnsRef, orderBy('order', 'asc'));
      const snapshot = await getDocs(q);
      
      const columns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      await this.renderColumns(categoryId, columns);
    } catch (error) {
      console.error("❌ Erreur chargement colonnes:", error);
    }
  }
  
  async renderColumns(categoryId, columns) {
    if (!this.columnsContainer) return;
    this.columnsContainer.innerHTML = '';
    
    for (const column of columns) {
      const columnEl = document.createElement('div');
      columnEl.className = 'mega-column';
      
      const titleEl = document.createElement('h4');
      titleEl.className = 'mega-column-title';
      titleEl.textContent = column.columnName || 'Sans titre';
      columnEl.appendChild(titleEl);
      
      const linesContainer = document.createElement('div');
      linesContainer.className = 'mega-lines';
      columnEl.appendChild(linesContainer);
      
      this.columnsContainer.appendChild(columnEl);
      
      await this.loadLines(categoryId, column.id, linesContainer);
    }
  }
  
  async loadLines(categoryId, columnId, container) {
    try {
      const linesRef = collection(db, 'categories_list', categoryId, 'columns', columnId, 'lines');
      const q = query(linesRef, orderBy('order', 'asc'));
      const snapshot = await getDocs(q);
      
      snapshot.forEach(doc => {
        const line = doc.data();
        const lineEl = document.createElement('button');
        lineEl.type = 'button';
        lineEl.className = 'mega-line';
        
        const lineImage = line.imageUrl || line.image;
        if (lineImage) {
          const img = document.createElement('img');
          img.src = lineImage.startsWith('http') ? lineImage : './' + lineImage;
          img.className = 'mega-line-image';
          img.alt = line.lineName || 'Ligne';
          img.onerror = function() { this.style.display = 'none'; };
          lineEl.appendChild(img);
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = line.lineName || 'Sans nom';
        lineEl.appendChild(nameSpan);

        lineEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.dispatchEvent(new CustomEvent('openCategorySectionFromMenu', {
            detail: {
              categoryId,
              categoryName: this.getCategoryName(categoryId) || '',
              columnId,
              lineId: doc.id,
              openFilters: true
            }
          }));
          this.close();
        });
        
        container.appendChild(lineEl);
      });
    } catch (error) {
      console.error("❌ Erreur chargement lignes:", error);
    }
  }
  
  async loadRecentProducts(categoryId) {
    try {
      if (!categoryId) {
        this.renderNoProducts();
        return;
      }
      
      
      const productsRef = collection(db, 'products');
      const q = query(
        productsRef, 
        where('categoryId', '==', categoryId),
        limit(20)
      );
      
      const snapshot = await getDocs(q);
      const products = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const aDate = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bDate = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bDate - aDate;
        })
        .slice(0, 2);
      
      this.renderRecentProducts(products);
      
    } catch (error) {
      console.error("❌ Erreur chargement produits récents:", error);
      this.renderNoProducts();
    }
  }
  
  renderRecentProducts(products) {
    if (!this.featuredContainer) return;
    
    if (products.length === 0) {
      this.renderNoProducts();
      return;
    }
    
    const colors = theme.getColors();
    
    this.featuredContainer.innerHTML = products.slice(0, 2).map(product => {
      const productImages = product.images || [];
      const firstImage = productImages.length > 0 ? productImages[0] : null;
      
      let imageUrl = 'https://via.placeholder.com/80?text=Produit';
      if (firstImage) {
        if (firstImage.startsWith('http')) {
          imageUrl = firstImage;
        } else {
          imageUrl = './' + firstImage.split('/').pop();
        }
      }
      
      const productPrice = this.formatPriceHTG(product.price || 0);
      const oldPrice = product.comparePrice ? this.formatPriceHTG(product.comparePrice) : null;
      const productId = product.id;
      
      return `
        <div class="featured-card" style="cursor: pointer;" data-product-id="${productId}">
          ${oldPrice ? '<span class="featured-chip">OFFRE</span>' : ''}
          <img src="${imageUrl}" alt="${product.name || 'Produit'}" 
               class="featured-media"
               onerror="this.src='https://via.placeholder.com/80?text=img'; this.onerror=null;">
          <div class="featured-content">
            <h4 style="font-family: ${theme.getTypography().family || theme.getFonts().primary || 'Cormorant Garamond, serif'}; 
                       font-weight: 600; 
                       margin: 0;
                       line-height: 1.2;
                       font-size: 1rem;
                       color: ${colors?.text?.title || '#1F1E1C'};">
              ${product.name || 'Produit sans nom'}
            </h4>
            <p class="featured-desc">
              ${product.shortDescription || product.description || ''}
            </p>
            <div class="featured-prices">
              <span class="featured-price">${productPrice}</span>
              ${oldPrice ? `<span class="featured-old-price">${oldPrice}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    this.attachProductClickEvents();
  }
  
  attachProductClickEvents() {
    const productCards = this.featuredContainer.querySelectorAll('.featured-card');
    
    productCards.forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const productId = card.dataset.productId;
        if (!productId) return;
        
        try {
          const module = await import('./product-modal.js');
          const ProductModal = module.default;
          
          new ProductModal({
            productId: productId,
            collectionName: 'products',
            imageBasePath: './'
          });
          
        } catch (error) {
          console.error('❌ Erreur chargement product-modal.js:', error);
          
          const product = await this.getProductById(productId);
          if (product && product.link) {
            window.open(product.link, '_blank');
          } else {
            alert('Impossible d\'ouvrir le produit');
          }
        }
      });
    });
  }
  
  async getProductById(productId) {
    try {
      const productsRef = collection(db, 'products');
      const q = query(productsRef, where('__name__', '==', productId), limit(1));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      }
    } catch (error) {
      console.error('❌ Erreur récupération produit:', error);
    }
    return null;
  }
  
  renderNoProducts() {
    if (!this.featuredContainer) return;
    
    const colors = theme.getColors();
    
    this.featuredContainer.innerHTML = `
      <div style="text-align: center; padding: 2rem 1rem; color: ${colors?.text?.body || '#8B7E6B'};">
        <i class="fas fa-box-open" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5; color: ${colors?.icon?.standard || '#8B7E6B'};"></i>
        <p style="margin-bottom: 0.5rem; color: ${colors?.text?.body || '#8B7E6B'};">Aucun produit disponible</p>
        <p style="font-size: 0.8rem; color: ${colors?.text?.body || '#8B7E6B'};">Dans cette catégorie pour le moment</p>
      </div>
    `;
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
  }
}

export default MegaMenu;
