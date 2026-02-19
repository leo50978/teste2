// ============= MOBILE-MENU.JS - VERSION AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { collection, getDocs, query, orderBy, where, limit } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import CategoriesSection from './categories-section.js';

class MobileMenu {
  constructor() {
    this.categoriesSectionClass = CategoriesSection;
    this.menuElement = document.getElementById('mobileMenuFullscreenOrion99');
    this.categories = [];
    this.currentCategoryId = null;
    this.currentCategoryName = '';
    this.unsubscribeTheme = null;
    
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
  
  init() {
    // S'abonner aux changements de thème
    this.unsubscribeTheme = theme.subscribe((themeData) => {
      this.applyTheme(themeData);
    });
    
    this.setupEvents();
    this.setupProductClickHandlers();
    this.applyTheme(theme.getColors()); // Appliquer le thème initial
  }
  
  applyTheme(themeData) {
    const colors = themeData.colors;
    
    if (!this.menuElement) return;
    
    // Appliquer les couleurs de fond
    if (colors?.background?.general) {
      this.menuElement.style.backgroundColor = colors.background.general;
    }
    
    // Appliquer les couleurs de texte via des variables CSS
    const style = document.createElement('style');
    style.id = 'mobile-menu-theme-styles';
    style.textContent = `
      .mobile-menu-header {
        border-bottom-color: ${colors?.icon?.standard || '#C6A75E'}20 !important;
      }
      .mobile-menu-title {
        color: ${colors?.text?.title || '#1F1E1C'} !important;
      }
      .mobile-menu-close {
        color: ${colors?.icon?.standard || '#1F1E1C'} !important;
      }
      .mobile-menu-close:hover {
        background: ${colors?.icon?.hover || '#C6A75E'}20 !important;
        color: ${colors?.icon?.hover || '#C6A75E'} !important;
      }
      .mobile-category-name {
        color: ${colors?.text?.body || '#333333'} !important;
      }
      .mobile-category-card:hover .mobile-category-name {
        color: ${colors?.icon?.hover || '#C6A75E'} !important;
      }
      .mobile-category-image {
        border-color: ${colors?.icon?.standard || '#C6A75E'} !important;
      }
      .mobile-category-card:hover .mobile-category-image {
        border-color: ${colors?.icon?.hover || '#C6A75E'} !important;
      }
      .mobile-column-title {
        color: ${colors?.text?.title || '#1F1E1C'} !important;
        border-bottom-color: ${colors?.icon?.standard || '#C6A75E'} !important;
      }
      .mobile-line-item {
        color: ${colors?.text?.body || '#333333'} !important;
        background: ${colors?.background?.card || '#F5F5F5'} !important;
      }
      .mobile-line-item:hover {
        background: ${colors?.icon?.hover || '#C6A75E'}20 !important;
        color: ${colors?.icon?.hover || '#C6A75E'} !important;
      }
      .mobile-featured-title {
        color: ${colors?.text?.title || '#1F1E1C'} !important;
      }
      .mobile-featured-card {
        background: ${colors?.background?.card || '#F5F5F5'} !important;
        border-color: ${colors?.icon?.standard || '#C6A75E'}20 !important;
      }
      .mobile-featured-card:hover {
        border-color: ${colors?.icon?.hover || '#C6A75E'} !important;
        transform: translateY(-2px);
      }
      .mobile-featured-card h4 {
        color: ${colors?.text?.title || '#1F1E1C'} !important;
      }
      .mobile-featured-card p {
        color: ${colors?.text?.body || '#666666'} !important;
      }
      .mobile-featured-card span {
        color: ${colors?.text?.button || '#FFFFFF'} !important;
      }
      .mobile-back-arrow {
        color: ${colors?.icon?.standard || '#1F1E1C'} !important;
      }
      .mobile-back-arrow:hover {
        background: ${colors?.icon?.hover || '#C6A75E'}20 !important;
        color: ${colors?.icon?.hover || '#C6A75E'} !important;
      }
    `;
    
    // Supprimer l'ancien style s'il existe
    const oldStyle = document.getElementById('mobile-menu-theme-styles');
    if (oldStyle) oldStyle.remove();
    
    document.head.appendChild(style);
  }
  
  setupEvents() {
    const hamburger = document.getElementById('mobileHamburgerBtn');
    const closeBtn = document.getElementById('closeMobileMenuBtn');
    const footerCloseBtn = document.getElementById('mobileMenuFooterCloseBtn');
    
    if (hamburger) {
      hamburger.addEventListener('click', () => this.open());
    }
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    if (footerCloseBtn) {
      footerCloseBtn.addEventListener('click', () => this.close());
    }
    
    // Niveaux de navigation
    const backToCategories = document.getElementById('mobileBackToCategoriesArrow');
    const backToColumns = document.getElementById('mobileBackToColumnsArrow');
    
    if (backToCategories) {
      backToCategories.addEventListener('click', () => this.showCategoriesLevel());
    }
    
    if (backToColumns) {
      backToColumns.addEventListener('click', () => this.showColumnsLevel());
    }
  }
  
  setupProductClickHandlers() {
    // Écouter les clics sur les produits pour ouvrir le modal
    document.addEventListener('click', async (e) => {
      const productCard = e.target.closest('.mobile-featured-card');
      if (!productCard) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const productId = productCard.dataset.productId;
      if (!productId) return;
      
      
      try {
        const module = await import('./product-modal.js');
        const ProductModal = module.default;
        
        new ProductModal({
          productId: productId,
          collectionName: 'products',
          imageBasePath: './'
        });
        
        // Fermer le menu mobile
        this.close();
        
      } catch (error) {
        console.error('❌ Erreur chargement product-modal.js:', error);
        
        // Fallback: ouvrir le lien si disponible
        const productLink = productCard.dataset.productLink;
        if (productLink && productLink !== '#') {
          window.open(productLink, '_blank');
        }
      }
    });
  }
  
  setCategories(categories) {
    this.categories = categories;
    this.renderCategories();
  }
  
  renderCategories() {
    const container = document.getElementById('mobileCategoryCarousel');
    if (!container) return;
    
    container.innerHTML = '';
    
    this.categories.slice(0, 8).forEach(cat => {
      const card = document.createElement('div');
      card.className = 'mobile-category-card';
      card.setAttribute('data-category-id', cat.id);
      
      // Utiliser l'image de la catégorie si disponible
      const imageUrl = cat.image || 'https://via.placeholder.com/90';
      
      card.innerHTML = `
        <img src="${imageUrl}" class="mobile-category-image" alt="${cat.name}" onerror="this.src='https://via.placeholder.com/90?text='+encodeURIComponent('${cat.name?.charAt(0)}');">
        <span class="mobile-category-name">${cat.name}</span>
      `;
      
      card.addEventListener('click', () => this.showColumnsLevel(cat.id, cat.name));
      container.appendChild(card);
    });
  }
  
  open() {
    if (!this.menuElement) return;
    
    document.getElementById('mobileCategoriesLevel').style.display = 'block';
    document.getElementById('mobileColumnsLevel').style.display = 'none';
    document.getElementById('mobileLinesLevel').style.display = 'none';
    
    this.menuElement.style.display = 'block';
    this.menuElement.classList.add('is-open');
    this.menuElement.scrollTop = 0;
    const content = document.getElementById('mobileMenuContent');
    if (content) content.scrollTop = 0;
    setTimeout(() => {
      this.menuElement.style.opacity = '1';
    }, 50);
    
    // Bloquer le scroll du body
    document.body.style.overflow = 'hidden';
  }
  
  close() {
    if (!this.menuElement) return;
    
    this.menuElement.style.opacity = '0';
    this.menuElement.classList.remove('is-open');
    setTimeout(() => {
      this.menuElement.style.display = 'none';
      document.body.style.overflow = '';
    }, 400);
  }
  
  showCategoriesLevel() {
    document.getElementById('mobileCategoriesLevel').style.display = 'block';
    document.getElementById('mobileColumnsLevel').style.display = 'none';
    document.getElementById('mobileLinesLevel').style.display = 'none';
  }
  
  showColumnsLevel() {
    document.getElementById('mobileColumnsLevel').style.display = 'block';
    document.getElementById('mobileLinesLevel').style.display = 'none';
  }
  
  async showColumnsLevel(categoryId, categoryName) {
    this.currentCategoryId = categoryId;
    this.currentCategoryName = categoryName;
    
    document.getElementById('mobileCategoriesLevel').style.display = 'none';
    document.getElementById('mobileColumnsLevel').style.display = 'block';
    document.getElementById('mobileLinesLevel').style.display = 'none';
    
    const titleEl = document.getElementById('mobileCurrentCategoryTitle');
    if (titleEl) titleEl.textContent = categoryName;
    
    await Promise.all([
      this.loadColumns(categoryId),
      this.loadMobileFeaturedProducts(categoryId)
    ]);
  }
  
  async loadColumns(categoryId) {
    try {
      const columnsRef = collection(db, 'categories_list', categoryId, 'columns');
      const q = query(columnsRef, orderBy('order', 'asc'));
      const snapshot = await getDocs(q);
      const columns = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      this.renderColumns(categoryId, columns);
    } catch (error) {
      console.error("❌ Erreur chargement colonnes mobile:", error);
    }
  }
  
  renderColumns(categoryId, columns) {
    const container = document.getElementById('mobileColumnsContainer');
    if (!container) return;
    
    container.innerHTML = '<div id="mobileColumnsList" class="space-y-4"></div>';
    const columnsList = document.getElementById('mobileColumnsList');
    
    columns.forEach(column => {
      const colDiv = document.createElement('div');
      colDiv.className = 'mb-6';
      
      const title = document.createElement('h4');
      title.className = 'mobile-column-title font-medium text-lg mb-3';
      title.textContent = column.columnName || 'Sans titre';
      colDiv.appendChild(title);
      
      const linesContainer = document.createElement('div');
      linesContainer.className = 'space-y-2';
      colDiv.appendChild(linesContainer);
      
      columnsList.appendChild(colDiv);
      
      this.loadLines(categoryId, column.id, linesContainer);
    });
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
        lineEl.className = 'mobile-line-item block p-3 rounded-lg transition-colors';
        
        const lineImage = line.imageUrl || line.image;
        if (lineImage) {
          lineEl.innerHTML = `
            <div class="flex items-center gap-3">
              <img src="${lineImage.startsWith('http') ? lineImage : './' + lineImage}" 
                   class="w-10 h-10 rounded object-cover" 
                   alt="${line.lineName || ''}" 
                   onerror="this.style.display='none';">
              <span>${line.lineName || 'Sans nom'}</span>
            </div>
          `;
        } else {
          lineEl.textContent = line.lineName || 'Sans nom';
        }

        lineEl.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          document.dispatchEvent(new CustomEvent('openCategorySectionFromMenu', {
            detail: {
              categoryId,
              categoryName: this.currentCategoryName || '',
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
      console.error("❌ Erreur chargement lignes mobile:", error);
    }
  }
  
  async loadMobileFeaturedProducts(categoryId) {
    try {
      if (!categoryId) {
        this.renderMobileNoProducts();
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
      
      
      this.renderMobileFeaturedProducts(products);
      
    } catch (error) {
      console.error("❌ Erreur chargement produits mobiles:", error);
      this.renderMobileNoProducts();
    }
  }
  
  renderMobileFeaturedProducts(products) {
    const container = document.getElementById('mobileFeaturedColumns');
    if (!container) return;
    
    if (products.length === 0) {
      this.renderMobileNoProducts();
      return;
    }
    
    container.style.display = 'block';
    
    container.innerHTML = `
      <h3 class="mobile-featured-title">Sélection Prestige</h3>
      ${products.slice(0, 2).map(product => {
        // Prendre la première image du tableau
        const productImages = product.images || [];
        const firstImage = productImages.length > 0 ? productImages[0] : null;
        
        let imageUrl = 'https://via.placeholder.com/70?text=Produit';
        if (firstImage) {
          if (firstImage.startsWith('http')) {
            imageUrl = firstImage;
          } else {
            imageUrl = './' + firstImage.split('/').pop();
          }
        }
        
        const productPrice = this.formatPriceHTG(product.price || 0);
        const oldPrice = product.comparePrice ? this.formatPriceHTG(product.comparePrice) : null;
        
        return `
          <div class="mobile-featured-card" data-product-id="${product.id}" data-product-link="${product.link || '#'}">
            <img src="${imageUrl}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 12px;" 
                 onerror="this.src='https://via.placeholder.com/70?text=img'; this.onerror=null;">
            <div style="flex: 1;">
              <h4 style="font-family: var(--primary-font); font-weight: 600; margin-bottom: 0.2rem;">${product.name || 'Produit'}</h4>
              <p style="font-size: 0.75rem; margin-bottom: 0.3rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                ${product.shortDescription || product.description || ''}
              </p>
              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <span style="font-weight: 700;">${productPrice}</span>
                ${oldPrice ? `<span style="font-size: 0.7rem; text-decoration: line-through;">${oldPrice}</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;
  }
  
  renderMobileNoProducts() {
    const container = document.getElementById('mobileFeaturedColumns');
    if (!container) return;
    
    container.style.display = 'block';
    container.innerHTML = `
      <div style="text-align: center; padding: 1.5rem; background: rgba(198,167,94,0.05); border-radius: 1rem;">
        <i class="fas fa-box-open" style="font-size: 2rem; opacity: 0.5; margin-bottom: 0.5rem;"></i>
        <p>Aucun produit vedette</p>
      </div>
    `;
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
  }
}

export default MobileMenu;
