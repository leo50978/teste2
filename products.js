// ============= PRODUCTS COMPONENT - CAROUSEL HORIZONTAL =============
import { db } from './firebase-init.js';
import { 
  collection, query, getDocs, limit 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class SierraProducts {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Products: Container #${containerId} non trouvé`);
      return;
    }
    
    // Options par défaut
    this.options = {
      collectionName: 'products',
      filterActive: true,
      imageBasePath: './',
      animationDuration: 800,
      visibleProductsDesktop: 4,
      visibleProductsMobile: 1.2,
      scrollIndicator: true,
      maxRelatedProducts: 6,
      ...options
    };
    
    // États
    this.products = [];
    this.uniqueId = 'products_' + Math.random().toString(36).substr(2, 9);
    this.currentImageIndex = new Map(); // Pour suivre l'image par produit/variation
    this.isScrolling = false;
    this.scrollTimeout = null;
    this.currentModal = null;
    this.ProductModalClass = null;
    this.productObserver = null;
    
    this.init();
  }
  
  async init() {
    try {
      await this.loadProducts();
      this.render();
      this.attachEvents();
      this.setupProductScrollAnimation();
      this.initScrollIndicators();
      this.listenForModalEvents();
    } catch (error) {
      console.error('❌ Products: Erreur init', error);
      this.renderError();
    }
  }
  
  async loadProducts() {
    
    const q = query(
      collection(db, this.options.collectionName),
      limit(50)
    );
    
    const snapshot = await getDocs(q);
    this.products = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .filter(product => this.isProductVisible(product));
    
    // Initialiser l'index d'image pour chaque produit (première variation)
    this.products.forEach(product => {
      if (product.variations && product.variations.length > 0) {
        // Utiliser la première variation par défaut
        this.currentImageIndex.set(product.id, {
          variationIndex: 0,
          imageIndex: 0
        });
      }
    });
    
  }
  
  isProductVisible(product) {
    if (!this.options.filterActive) return true;
    
    // Nouvelle structure (Dproducts): status = active|draft
    if (typeof product.status === 'string') {
      return product.status === 'active';
    }
    
    // Ancienne structure: active = true|false (compat)
    if (typeof product.active === 'boolean') {
      return product.active !== false;
    }
    
    return true;
  }
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    return `${this.options.imageBasePath}${filename.split('/').pop()}`;
  }
  
  toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }
  
  getVariationImages(product, variationIndex = 0) {
    // Règle stricte: utiliser UNIQUEMENT products.images
    if (!Array.isArray(product?.images)) return [];
    return product.images.filter((img) => typeof img === 'string' && img.trim() !== '');
  }
  
  getVariationEffectivePrice(product, variation) {
    const variationPrice = this.toNumber(variation?.price, NaN);
    if (Number.isFinite(variationPrice) && variationPrice > 0) return variationPrice;
    return this.toNumber(product?.price, 0);
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency', 
      currency: 'HTG',
      minimumFractionDigits: 2
    }).format(price || 0);
  }
  
  // Obtenir la variation active d'un produit
  getActiveVariation(product) {
    if (!product.variations || product.variations.length === 0) {
      return null;
    }
    
    const state = this.currentImageIndex.get(product.id) || { variationIndex: 0, imageIndex: 0 };
    return product.variations[state.variationIndex] || product.variations[0];
  }
  
  // Obtenir le prix minimum d'un produit (toutes variations)
  getMinPrice(product) {
    if (!product.variations || product.variations.length === 0) {
      return this.toNumber(product.price, 0);
    }
    
    return Math.min(...product.variations.map(v => this.getVariationEffectivePrice(product, v)));
  }
  
  // Obtenir le prix maximum d'un produit (toutes variations)
  getMaxPrice(product) {
    if (!product.variations || product.variations.length === 0) {
      return this.toNumber(product.price, 0);
    }
    
    return Math.max(...product.variations.map(v => this.getVariationEffectivePrice(product, v)));
  }
  
  // Formater la plage de prix
  formatPriceRange(product) {
    const minPrice = this.getMinPrice(product);
    const maxPrice = this.getMaxPrice(product);
    
    if (minPrice === maxPrice) {
      return this.formatPrice(minPrice);
    } else {
      return `${this.formatPrice(minPrice)} - ${this.formatPrice(maxPrice)}`;
    }
  }
  
  render() {
    if (this.products.length === 0) {
      this.container.innerHTML = `
        <div class="products-empty-${this.uniqueId} text-center py-16 text-accent/70">
          <i class="fas fa-box-open text-5xl mb-4 opacity-50"></i>
          <p class="text-lg">Aucun produit disponible</p>
        </div>
      `;
      return;
    }
    
    const html = `
      <div class="products-wrapper-${this.uniqueId} w-full relative">
        <!-- En-tête avec indicateur de scroll -->
        <div class="flex justify-between items-center mb-6 px-4 md:px-6">
          <h2 class="font-primary text-2xl md:text-3xl text-luxury">
            Nos Produits
          </h2>
          ${this.options.scrollIndicator ? `
            <div class="scroll-indicator-${this.uniqueId} flex items-center gap-2 text-accent text-sm md:hidden">
              <span>Faites glisser</span>
              <i class="fas fa-arrow-right animate-pulse"></i>
            </div>
          ` : ''}
        </div>
        
        <!-- Carousel Container -->
        <div class="relative group">
          <!-- Flèches navigation desktop -->
          <button class="scroll-left-${this.uniqueId} hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 bg-luxury/80 text-ivory rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 hover:bg-secondary">
            <i class="fas fa-chevron-left"></i>
          </button>
          
          <button class="scroll-right-${this.uniqueId} hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 bg-luxury/80 text-ivory rounded-full items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 hover:bg-secondary">
            <i class="fas fa-chevron-right"></i>
          </button>
          
          <!-- Carousel -->
          <div class="products-carousel-${this.uniqueId} overflow-x-auto overflow-y-visible scroll-smooth pb-4 hide-scrollbar" 
               style="scrollbar-width: none; -ms-overflow-style: none;">
            <div class="flex gap-4 md:gap-6 px-4 md:px-6" style="width: max-content;">
              ${this.products.map((product, index) => this.renderProductCard(product, index)).join('')}
            </div>
          </div>
        </div>
        
        <!-- Indicateur de scroll pour mobile -->
        <div class="scroll-progress-${this.uniqueId} md:hidden flex justify-center mt-4 gap-1">
          ${this.products.slice(0, 6).map((_, i) => `
            <div class="progress-dot h-1 w-6 bg-accent/30 rounded-full transition-all duration-300" data-index="${i}"></div>
          `).join('')}
        </div>
      </div>
      
      <style>
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        
        .products-carousel-${this.uniqueId} {
          cursor: grab;
          user-select: none;
        }
        
        .products-carousel-${this.uniqueId}:active {
          cursor: grabbing;
        }
        
        .product-card-${this.uniqueId} {
          width: calc(100vw - 2rem);
          max-width: 280px;
          transition: all 0.3s ease;
        }

        .product-card-${this.uniqueId}.scroll-hidden {
          opacity: 0;
          transform: translateY(24px) scale(0.98);
        }

        .product-card-${this.uniqueId}.scroll-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
          transition:
            opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.7s cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 0.3s ease;
        }
        
        @media (min-width: 768px) {
          .product-card-${this.uniqueId} {
            width: 280px;
          }
        }
        
        .product-card-${this.uniqueId}:hover {
          transform: translateY(-4px);
        }
        
        .product-image-container-${this.uniqueId} {
          position: relative;
          overflow: hidden;
          border-radius: 0.5rem;
          aspect-ratio: 1;
        }
        
        .product-image-container-${this.uniqueId}:hover .nav-arrow {
          opacity: 1;
        }
        
        .nav-arrow {
          opacity: 0;
          transition: opacity 0.3s ease;
          background: rgba(31, 30, 28, 0.7);
          color: white;
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
        }
        
        .nav-arrow:hover {
          background: #C6A75E;
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
          color: white;
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 0.7rem;
        }
        
        .variation-indicator {
          position: absolute;
          bottom: 5px;
          left: 5px;
          display: flex;
          gap: 4px;
        }
        
        .variation-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          border: 1px solid white;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          cursor: pointer;
          transition: transform 0.2s;
        }
        
        .variation-dot:hover {
          transform: scale(1.2);
        }
        
        .variation-dot.active {
          border: 2px solid #C6A75E;
        }
        
        .price-range {
          font-size: 0.9rem;
          color: #8B7E6B;
        }
        
        .price-barre {
          text-decoration: line-through;
          color: #8B7E6B;
          font-size: 0.9rem;
          margin-left: 0.5rem;
        }
        
        @keyframes pulse {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(5px); }
        }
        
        .scroll-indicator-${this.uniqueId} i {
          animation: pulse 1s infinite;
        }

        .mobile-actions-${this.uniqueId} {
          display: none;
          gap: 0.5rem;
          margin-top: 0.75rem;
        }

        .mobile-actions-${this.uniqueId} .mobile-cart-btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.4rem;
          padding: 0.55rem 0.75rem;
          border-radius: 999px;
          border: 1px solid rgba(198, 167, 94, 0.35);
          background: #FFFFFF;
          color: #1F1E1C;
          font-size: 0.85rem;
          font-weight: 600;
        }

        .mobile-actions-${this.uniqueId} .mobile-cart-btn {
          background: #1F1E1C;
          color: #F5F1E8;
          border-color: #C6A75E;
        }

        @media (max-width: 768px) {
          .mobile-actions-${this.uniqueId} {
            display: flex;
          }

          .product-image-container-${this.uniqueId} {
            background: #FFFFFF;
          }

          .product-main-image {
            object-fit: contain !important;
            padding: 0.35rem;
          }
        }
      </style>
    `;
    
    this.container.innerHTML = html;
  }
  
  renderProductCard(product, index) {
    const hasVariations = product.variations && product.variations.length > 0;
    const activeVariation = this.getActiveVariation(product);
    
    // Images à afficher (règle stricte: products.images uniquement)
    let images = [];
    let currentImageIndex = 0;
    let currentVariationIndex = 0;
    
    if (hasVariations) {
      const state = this.currentImageIndex.get(product.id) || { variationIndex: 0, imageIndex: 0 };
      currentVariationIndex = state.variationIndex;
      currentImageIndex = state.imageIndex;
      
      images = this.getVariationImages(product, currentVariationIndex);
    } else {
      images = this.getVariationImages(product, 0);
    }
    
    const mainImage = images[currentImageIndex] || '';
    const hasMultipleImages = images.length > 1;
    const hasMultipleVariations = hasVariations && product.variations.length > 1;
    
    // Prix
    let priceDisplay = '';
    if (hasVariations) {
      priceDisplay = this.formatPriceRange(product);
    } else {
      priceDisplay = this.formatPrice(product.price || 0);
    }
    
    return `
      <div class="product-card-${this.uniqueId} scroll-hidden relative" style="--index: ${index}" data-product-id="${product.id}">
        <div class="product-content cursor-pointer">
          <!-- Image Container -->
          <div class="product-image-container-${this.uniqueId} mb-3">
            <div class="w-full h-full bg-ivory rounded-lg overflow-hidden relative">
              <img src="${this.getImagePath(mainImage)}" 
                   alt="${product.name || 'Produit'}" 
                   class="product-main-image w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                   data-product-id="${product.id}"
                   data-variation-index="${currentVariationIndex}"
                   data-image-index="${currentImageIndex}"
                   loading="lazy"
                   onerror="this.src=''; this.parentElement.innerHTML='<div class=\'w-full h-full flex items-center justify-center text-accent/30\'><i class=\'fas fa-image text-3xl\'></i></div>'">
              
              <!-- Indicateurs de variations (couleurs) -->
              ${hasMultipleVariations ? `
                <div class="variation-indicator">
                  ${product.variations.map((variation, vIndex) => `
                    <span class="variation-dot ${vIndex === currentVariationIndex ? 'active' : ''}" 
                          style="background: ${variation.color || '#ccc'};"
                          data-variation-index="${vIndex}"
                          title="${variation.colorName || ''}"></span>
                  `).join('')}
                </div>
              ` : ''}
              
              <!-- Navigation images -->
              ${hasMultipleImages ? `
                <div class="nav-arrow left prev-image" data-product-id="${product.id}">
                  <i class="fas fa-chevron-left text-xs"></i>
                </div>
                <div class="nav-arrow right next-image" data-product-id="${product.id}">
                  <i class="fas fa-chevron-right text-xs"></i>
                </div>
                <div class="image-counter">
                  ${currentImageIndex + 1}/${images.length}
                </div>
              ` : ''}
            </div>
          </div>
          
          <!-- Product Info -->
          <div class="px-1">
            <h3 class="font-medium text-luxury text-lg mb-1 line-clamp-2">
              ${product.name || 'Produit sans nom'}
            </h3>
            
            <p class="text-accent text-sm mb-2 line-clamp-2">
              ${product.shortDescription || ''}
            </p>
            
            <div class="flex items-baseline flex-wrap">
              <span class="text-xl font-bold text-luxury">
                ${priceDisplay}
              </span>
              ${!hasVariations && product.comparePrice ? `
                <span class="price-barre ml-2">
                  ${this.formatPrice(product.comparePrice)}
                </span>
              ` : ''}
            </div>
            
            ${hasVariations ? `
              <div class="text-xs text-accent mt-1">
                ${product.variations.length} couleur(s) disponible(s)
              </div>
            ` : ''}

            <div class="mobile-actions-${this.uniqueId}">
              <button class="mobile-cart-btn" data-product-id="${product.id}">
                <i class="fas fa-shopping-bag"></i>
                <span>Ajouter</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }
  
  attachEvents() {
    const carousel = this.container.querySelector(`.products-carousel-${this.uniqueId}`);
    if (!carousel) return;
    
    // Variables pour le drag
    let isDown = false;
    let startX;
    let scrollLeft;
    
    // Drag events
    carousel.addEventListener('mousedown', (e) => {
      isDown = true;
      carousel.classList.add('active');
      startX = e.pageX - carousel.offsetLeft;
      scrollLeft = carousel.scrollLeft;
    });
    
    carousel.addEventListener('mouseleave', () => {
      isDown = false;
      carousel.classList.remove('active');
    });
    
    carousel.addEventListener('mouseup', () => {
      isDown = false;
      carousel.classList.remove('active');
    });
    
    carousel.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - carousel.offsetLeft;
      const walk = (x - startX) * 2;
      carousel.scrollLeft = scrollLeft - walk;
    });
    
    // Scroll events pour indicateur mobile
    carousel.addEventListener('scroll', () => {
      if (!this.isScrolling) {
        window.requestAnimationFrame(() => {
          this.updateScrollIndicator(carousel);
          this.isScrolling = false;
        });
        this.isScrolling = true;
      }
    });
    
    // Navigation flèches
    const leftBtn = this.container.querySelector(`.scroll-left-${this.uniqueId}`);
    const rightBtn = this.container.querySelector(`.scroll-right-${this.uniqueId}`);
    
    if (leftBtn) {
      leftBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: -300, behavior: 'smooth' });
      });
    }
    
    if (rightBtn) {
      rightBtn.addEventListener('click', () => {
        carousel.scrollBy({ left: 300, behavior: 'smooth' });
      });
    }
    
    // Navigation images
    this.container.querySelectorAll('.prev-image').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        this.navigateImage(productId, 'prev');
      });
    });
    
    this.container.querySelectorAll('.next-image').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        this.navigateImage(productId, 'next');
      });
    });
    
    // Navigation variations (changement de couleur)
    this.container.querySelectorAll('.variation-dot').forEach(dot => {
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        const productCard = dot.closest(`.product-card-${this.uniqueId}`);
        const productId = productCard.dataset.productId;
        const variationIndex = parseInt(dot.dataset.variationIndex);
        
        if (productId && !isNaN(variationIndex)) {
          this.switchVariation(productId, variationIndex);
        }
      });
    });

    this.container.querySelectorAll('.mobile-cart-btn').forEach(btn => {
      const handleCart = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const productId = btn.dataset.productId;
        if (productId) {
          this.openProductModal(productId);
        }
      };
      btn.addEventListener('click', handleCart);
      btn.addEventListener('pointerup', handleCart);
      btn.addEventListener('touchend', handleCart, { passive: false });
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
    });
    
    // Clic sur la carte produit pour ouvrir le modal
    this.container.querySelectorAll('.product-content').forEach(wrapper => {
      wrapper.addEventListener('click', (e) => {
        // Éviter de déclencher si on clique sur les flèches ou les dots
        if (e.target.closest('.prev-image') || 
            e.target.closest('.next-image') || 
            e.target.closest('.variation-dot')) {
          return;
        }
        
        const productCard = wrapper.closest(`.product-card-${this.uniqueId}`);
        const productId = productCard?.dataset.productId;
        
        if (productId) {
          this.openProductModal(productId);
        }
      });
    });
  }
  
  switchVariation(productId, variationIndex) {
    const product = this.products.find(p => p.id === productId);
    if (!product || !product.variations || !product.variations[variationIndex]) return;
    
    const state = this.currentImageIndex.get(productId) || { variationIndex: 0, imageIndex: 0 };
    state.variationIndex = variationIndex;
    state.imageIndex = 0; // Reset à la première image de la nouvelle variation
    this.currentImageIndex.set(productId, state);
    
    // Mettre à jour l'affichage
    const productCard = this.container.querySelector(`.product-card-${this.uniqueId}[data-product-id="${productId}"]`);
    if (productCard) {
      const variation = product.variations[variationIndex];
      const images = this.getVariationImages(product, variationIndex);
      const img = productCard.querySelector('.product-main-image');
      const counter = productCard.querySelector('.image-counter');
      
      if (img && images.length > 0) {
        img.src = this.getImagePath(images[0]);
      }
      
      if (counter) {
        counter.textContent = `1/${images.length}`;
      }
      
      // Mettre à jour les dots
      productCard.querySelectorAll('.variation-dot').forEach((dot, i) => {
        if (i === variationIndex) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
      
      // Animation
      if (img && typeof anime !== 'undefined') {
        anime({
          targets: img,
          scale: [1, 0.9, 1],
          opacity: [1, 0.7, 1],
          duration: 300,
          easing: 'easeInOutQuad'
        });
      }
    }
  }
  
  navigateImage(productId, direction) {
    const product = this.products.find(p => p.id === productId);
    if (!product) return;
    
    const state = this.currentImageIndex.get(productId) || { variationIndex: 0, imageIndex: 0 };
    
    // Déterminer les images à utiliser (variation active ou produit)
    let images = this.getVariationImages(product, state.variationIndex);
    
    if (images.length <= 1) return;
    
    if (direction === 'prev') {
      state.imageIndex = (state.imageIndex - 1 + images.length) % images.length;
    } else {
      state.imageIndex = (state.imageIndex + 1) % images.length;
    }
    
    this.currentImageIndex.set(productId, state);
    
    // Mettre à jour l'image
    const productCard = this.container.querySelector(`.product-card-${this.uniqueId}[data-product-id="${productId}"]`);
    if (productCard) {
      const img = productCard.querySelector('.product-main-image');
      const counter = productCard.querySelector('.image-counter');
      
      if (img) {
        img.src = this.getImagePath(images[state.imageIndex]);
        img.dataset.imageIndex = state.imageIndex;
      }
      
      if (counter) {
        counter.textContent = `${state.imageIndex + 1}/${images.length}`;
      }
      
      // Animation
      if (img && typeof anime !== 'undefined') {
        anime({
          targets: img,
          scale: [1, 0.9, 1],
          opacity: [1, 0.7, 1],
          duration: 300,
          easing: 'easeInOutQuad'
        });
      }
    }
  }
  
  async openProductModal(productId) {
    try {
      // Importer dynamiquement le modal
      if (!this.ProductModalClass) {
        const module = await import('./product-modal.js');
        this.ProductModalClass = module.default;
      }
      
      // Fermer le modal existant s'il y en a un
      if (this.currentModal) {
        await this.currentModal.close();
      }
      
      // Ouvrir le nouveau modal
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
    // Écouter les événements d'ouverture de produit (pour les produits liés)
    document.addEventListener('openProductModal', (e) => {
      if (e.detail?.productId) {
        this.openProductModal(e.detail.productId);
      }
    });
    
    // Écouter les mises à jour du panier
    document.addEventListener('cartUpdated', (e) => {
    });

  }

  disconnectProductObserver() {
    if (this.productObserver) {
      this.productObserver.disconnect();
      this.productObserver = null;
    }
  }

  setupProductScrollAnimation() {
    this.disconnectProductObserver();

    const cards = this.container.querySelectorAll(`.product-card-${this.uniqueId}`);
    if (!cards.length) return;

    const carousel = this.container.querySelector(`.products-carousel-${this.uniqueId}`);
    const revealCard = (card) => {
      if (!card.classList.contains('scroll-visible')) {
        const index = Number(card.style.getPropertyValue('--index') || 0);
        card.style.transitionDelay = `${Math.min(index * 80, 640)}ms`;
      }
      card.classList.remove('scroll-hidden');
      card.classList.add('scroll-visible');
    };

    if (!('IntersectionObserver' in window)) {
      cards.forEach(revealCard);
      return;
    }

    this.productObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealCard(entry.target);
        this.productObserver.unobserve(entry.target);
      });
    }, {
      root: null,
      threshold: 0.25,
      rootMargin: '0px 0px -8% 0px'
    });

    cards.forEach((card) => this.productObserver.observe(card));
  }
  
  updateScrollIndicator(carousel) {
    const scrollPercentage = (carousel.scrollLeft / (carousel.scrollWidth - carousel.clientWidth)) * 100;
    const dots = this.container.querySelectorAll('.progress-dot');
    
    if (dots.length > 0 && !isNaN(scrollPercentage)) {
      const activeDotIndex = Math.floor((scrollPercentage / 100) * (dots.length - 1));
      dots.forEach((dot, i) => {
        if (i <= activeDotIndex) {
          dot.classList.add('bg-secondary');
          dot.classList.remove('bg-accent/30');
        } else {
          dot.classList.remove('bg-secondary');
          dot.classList.add('bg-accent/30');
        }
      });
    }
  }
  
  initScrollIndicators() {
    const indicator = this.container.querySelector(`.scroll-indicator-${this.uniqueId}`);
    if (indicator && typeof anime !== 'undefined') {
      setTimeout(() => {
        anime({
          targets: indicator,
          translateX: [0, 10, 0],
          duration: 1000,
          loop: 3,
          easing: 'easeInOutQuad'
        });
      }, 1000);
    }
    
    if (this.products.length > this.options.visibleProductsDesktop && typeof anime !== 'undefined') {
      const rightArrow = this.container.querySelector(`.scroll-right-${this.uniqueId}`);
      if (rightArrow) {
        setTimeout(() => {
          anime({
            targets: rightArrow,
            scale: [1, 1.2, 1],
            duration: 600,
            loop: 2,
            easing: 'easeInOutQuad'
          });
        }, 1500);
      }
    }
  }
  
  initAnimations() {
    // Conservé pour compatibilité, désormais l'animation principale est au scroll
    const carousel = this.container.querySelector(`.products-carousel-${this.uniqueId}`);
    if (carousel && this.products.length > this.options.visibleProductsMobile) {
      setTimeout(() => {
        carousel.scrollBy({ left: 50, behavior: 'smooth' });
        setTimeout(() => {
          carousel.scrollBy({ left: -50, behavior: 'smooth' });
        }, 300);
      }, 2000);
    }
  }
  
  renderError() {
    this.container.innerHTML = `
      <div class="products-error-${this.uniqueId} text-center py-16 text-danger">
        <i class="fas fa-exclamation-triangle text-5xl mb-4"></i>
        <p class="text-lg">Erreur de chargement des produits</p>
        <p class="text-sm text-accent mt-2">Veuillez rafraîchir la page</p>
      </div>
    `;
  }
  
  // Méthode publique pour recharger les produits
  async reload() {
    await this.loadProducts();
    this.render();
    this.attachEvents();
    this.setupProductScrollAnimation();
    this.initAnimations();
  }
  
  // Méthode publique pour obtenir un produit par ID
  getProductById(id) {
    return this.products.find(p => p.id === id);
  }
  
  // Méthode publique pour filtrer les produits
  filterProducts(callback) {
    return this.products.filter(callback);
  }

  destroy() {
    this.disconnectProductObserver();
  }
}

export default SierraProducts;
