// ============= PRODUCT MODAL COMPONENT =============
import { db } from './firebase-init.js';
import { getLikeManager } from './like.js';
import { 
  doc, getDoc, collection, query, getDocs, limit 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class ProductModal {
  constructor(options = {}) {
    this.options = {
      productId: null,
      collectionName: 'products',
      imageBasePath: './',
      onClose: null,
      onAddToCart: null,
      ...options
    };
    
    this.product = null;
    this.relatedProducts = [];
    this.selectedOptions = new Map();
    this.currentImageIndex = 0;
    this.currentVariationIndex = 0;
    this.selectedQuantity = 0;
    this.variationQuantities = new Map();
    this.likeManager = getLikeManager();
    this.onLikesUpdated = () => this.syncLikeButton();
    this.isFullscreen = false;
    this.uniqueId = 'modal_' + Math.random().toString(36).substr(2, 9);
    
    this.init();
  }
  
  async init() {
    if (!this.options.productId) {
      console.error('❌ ProductModal: ID produit requis');
      return;
    }
    
    await this.loadProduct();
    await this.loadRelatedProducts();
    this.render();
    this.attachEvents();
    this.loadFromLocalStorage();
    this.animateIn();
    
    // Bloquer le scroll du body
    document.body.style.overflow = 'hidden';
  }
  
  async loadProduct() {
    try {
      const docRef = doc(db, this.options.collectionName, this.options.productId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        this.product = {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        console.error('❌ Produit non trouvé');
      }
    } catch (error) {
      console.error('❌ Erreur chargement produit:', error);
    }
  }
  
  async loadRelatedProducts() {
    try {
      const q = query(
        collection(db, this.options.collectionName),
        limit(30)
      );
      const snapshot = await getDocs(q);
      const products = snapshot.docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(p => p.id !== this.options.productId)
        .filter(p => this.isProductVisible(p));
      
      if (this.product?.categoryId) {
        const sameCategory = products.filter(p => p.categoryId === this.product.categoryId);
        const others = products.filter(p => p.categoryId !== this.product.categoryId);
        this.relatedProducts = [...sameCategory, ...others].slice(0, 6);
      } else {
        this.relatedProducts = products.slice(0, 6);
      }
    } catch (error) {
      console.error('❌ Erreur chargement produits liés:', error);
    }
  }
  
  isProductVisible(product) {
    if (typeof product?.status === 'string') return product.status === 'active';
    if (typeof product?.active === 'boolean') return product.active !== false;
    return true;
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
  
  getVariationEffectivePrice(variation, product = this.product) {
    const variationPrice = this.toNumber(variation?.price, NaN);
    if (Number.isFinite(variationPrice) && variationPrice > 0) return variationPrice;
    return this.toNumber(product?.price, 0);
  }
  
  getProductImages(product = this.product) {
    if (Array.isArray(product?.images) && product.images.length > 0) {
      return product.images;
    }
    
    const variationImages = [];
    (product?.variations || []).forEach(v => {
      if (Array.isArray(v?.images) && v.images.length > 0) {
        variationImages.push(...v.images);
      }
    });
    
    return variationImages;
  }
  
  getProductPrimaryImage(product = this.product) {
    const images = this.getProductImages(product);
    return images[0] || '';
  }
  
  getProductDisplayPrice(product = this.product) {
    const variations = Array.isArray(product?.variations) ? product.variations : [];
    if (variations.length === 0) {
      const price = this.toNumber(product?.price, 0);
      return { text: this.formatPrice(price), value: price };
    }
    
    const prices = variations.map(v => this.getVariationEffectivePrice(v, product));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return { text: this.formatPrice(min), value: min };
    return { text: `${this.formatPrice(min)} - ${this.formatPrice(max)}`, value: min };
  }
  
  getCurrentDisplayImages() {
    const variation = this.product?.variations?.[this.currentVariationIndex];
    if (Array.isArray(variation?.images) && variation.images.length > 0) {
      return variation.images;
    }
    
    if (Array.isArray(this.product?.images) && this.product.images.length > 0) {
      return this.product.images;
    }
    
    return this.getProductImages(this.product);
  }
  
  getVariationLabel(variation) {
    const parts = [];
    if (variation?.color) parts.push(variation.color);
    if (variation?.size) parts.push(variation.size);
    if (variation?.volume) parts.push(variation.volume);
    if (Array.isArray(variation?.customOptions)) {
      variation.customOptions.forEach(opt => {
        if (opt?.name && opt?.value) parts.push(`${opt.name}: ${opt.value}`);
      });
    }
    return parts.join(' • ') || variation?.sku || 'Variation';
  }
  
  render() {
    if (!this.product) {
      this.renderError();
      return;
    }
    
    const images = this.getProductImages(this.product);
    const mainImage = images[this.currentImageIndex] || '';
    
    // Créer l'overlay du modal avec z-index ultra élevé
    const modalHTML = `
     <div class="product-modal-overlay-${this.uniqueId}" style="
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  background: rgb(255, 255, 255);
  backdrop-filter: blur(5px);
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  box-sizing: border-box;
">
        <div class="product-modal-container-${this.uniqueId}" style="
          background: #F5F1E8;
          
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          width: 100%;
          height: 100vh;
         
          overflow: hidden;
          position: relative;
          display: flex;
          flex-direction: column;
          animation: modalSlideIn 0.3s ease;
        ">
          
          <!-- Header mobile -->
          <div class="md:hidden flex justify-between items-center p-4 border-b border-secondary/20" style="flex-shrink: 0;">
            <h2 class="font-primary text-lg truncate" style="font-family: 'Cormorant Garamond', serif;">${this.product.name || 'Produit'}</h2>
            <button class="close-modal-btn" style="width: 40px; height: 40px; border-radius: 50%; background: rgba(31, 30, 28, 0.1); display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;">
              <i class="fas fa-times" style="font-size: 1.25rem;"></i>
            </button>
          </div>
          
          <!-- Close button desktop -->
          <button class="close-modal-btn hidden md:flex" style="
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(31, 30, 28, 0.1);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20;
            transition: background 0.2s;
          " onmouseover="this.style.background='rgba(31, 30, 28, 0.2)'" onmouseout="this.style.background='rgba(31, 30, 28, 0.1)'">
            <i class="fas fa-times" style="font-size: 1.25rem;"></i>
          </button>
          
          <div style="flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;">
            <!-- Version Desktop (flex row) -->
            <div class="hidden md:flex" style="height: 100%;">
              <!-- Partie Gauche - Images -->
              <div style="width: 50%; padding: 1.5rem; border-right: 1px solid rgba(198, 167, 94, 0.2); overflow-y: auto;">
                <div class="product-images-desktop-root">
                  ${this.renderDesktopImages()}
                </div>
              </div>
              
              <!-- Partie Droite - Infos -->
              <div style="width: 50%; padding: 1.5rem; overflow-y: auto;">
                ${this.renderProductInfo()}
                ${this.renderRelatedProducts()}
              </div>
            </div>
            
            <!-- Version Mobile (flex column) -->
            <div class="md:hidden">
              <!-- Images en haut (85vh) -->
              <div style="height: 85vh; position: relative;">
                <div class="product-images-mobile-root">
                  ${this.renderMobileImages()}
                </div>
              </div>
              
              <!-- Infos en bas -->
              <div style="padding: 1rem;">
                ${this.renderProductInfo()}
                ${this.renderRelatedProducts()}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Fullscreen Image Viewer avec z-index encore plus élevé -->
      <div class="fullscreen-viewer-${this.uniqueId}" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        z-index: 1000000;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
      ">
        <button class="close-fullscreen-btn" style="
          position: absolute;
          top: 1rem;
          right: 1rem;
          color: white;
          background: none;
          border: none;
          font-size: 2rem;
          cursor: pointer;
          z-index: 10;
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <i class="fas fa-times"></i>
        </button>
        <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <img src="" alt="" class="fullscreen-img" style="max-width: 95%; max-height: 95%; object-fit: contain;">
          <button class="fullscreen-prev" style="
            position: absolute;
            left: 1rem;
            color: white;
            background: none;
            border: none;
            font-size: 3rem;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.2s;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button class="fullscreen-next" style="
            position: absolute;
            right: 1rem;
            color: white;
            background: none;
            border: none;
            font-size: 3rem;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.2s;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div class="fullscreen-counter" style="
            position: absolute;
            bottom: 1rem;
            color: white;
            background: rgba(0,0,0,0.5);
            padding: 0.25rem 1rem;
            border-radius: 2rem;
            font-size: 0.875rem;
          ">
            ${this.currentImageIndex + 1}/${images.length}
          </div>
        </div>
      </div>
      
      <style>
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        /* Styles pour les options */
        .option-item {
          transition: all 0.2s ease;
          cursor: pointer;
          border: 2px solid transparent;
        }
        
        .option-item.selected {
          border-color: #C6A75E !important;
          background: rgba(198, 167, 94, 0.1) !important;
        }
        
        /* Scrollbar personnalisée */
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar {
          width: 6px;
        }
        
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.05);
        }
        
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 3px;
        }
        
        /* Grille d'images desktop */
        .desktop-image-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }
        
        .desktop-image-item {
          aspect-ratio: 1;
          cursor: pointer;
          overflow: hidden;
          border-radius: 0.5rem;
          transition: all 0.3s;
        }
        
        .desktop-image-item:hover {
          transform: scale(1.02);
          box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        }
        
        .desktop-image-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        /* Carousel mobile */
        .mobile-image-carousel {
          height: 100%;
          position: relative;
        }
        
        .mobile-image-container {
          height: 100%;
          display: flex;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        
        .mobile-image-container::-webkit-scrollbar {
          display: none;
        }
        
        .mobile-image-slide {
          flex: 0 0 100%;
          scroll-snap-align: start;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        
        .mobile-image-slide img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        
        .mobile-nav-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          background: rgba(255,255,255,0.8);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        
        .mobile-nav-btn:hover {
          background: white;
        }
        
        .mobile-nav-btn.left {
          left: 10px;
        }
        
        .mobile-nav-btn.right {
          right: 10px;
        }
        
        /* Carousel produits liés */
        .related-products-carousel {
          display: flex;
          gap: 1rem;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          padding-bottom: 0.5rem;
        }
        
        .related-products-carousel .product-card {
          flex: 0 0 200px;
          scroll-snap-align: start;
          cursor: pointer;
        }

        .related-products-carousel .related-product-media {
          aspect-ratio: 1;
          background: #FFFFFF;
          border-radius: 0.5rem;
          overflow: hidden;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.35rem;
        }

        .related-products-carousel .related-product-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s;
        }
        
        @media (min-width: 768px) {
          .related-products-carousel .product-card {
            flex: 0 0 180px;
          }
        }

        @media (max-width: 767px) {
          .related-products-carousel .product-card {
            flex: 0 0 165px;
          }

          .related-products-carousel .related-product-image {
            object-fit: contain;
          }
        }
        
        .product-card:hover {
          transform: translateY(-2px);
        }
        
        .product-card:hover .related-product-image {
          transform: scale(1.1);
        }
        
        /* Line clamp */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        /* Animation de pulsation pour le bouton */
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        .add-to-cart-btn {
          animation: pulse 2s infinite;
        }
        
        /* Empêcher le scroll du body */
        body.modal-open {
          overflow: hidden !important;
        }
      </style>
    `;
    
    // Ajouter au body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalElement = document.querySelector(`.product-modal-overlay-${this.uniqueId}`);
    this.fullscreenViewer = document.querySelector(`.fullscreen-viewer-${this.uniqueId}`);
    
    // Ajouter la classe modal-open au body
    document.body.classList.add('modal-open');
  }
  
  renderDesktopImages() {
    const images = this.getCurrentDisplayImages();
    if (images.length === 0) {
      return '<div style="text-align: center; padding: 2rem; color: #8B7E6B;">Aucune image</div>';
    }
    
    return `
      <div class="desktop-image-grid">
        ${images.map((img, index) => `
          <div class="desktop-image-item" data-index="${index}">
            <img src="${this.getImagePath(img)}" alt="" loading="lazy">
          </div>
        `).join('')}
      </div>
    `;
  }
  
  renderMobileImages() {
    const images = this.getCurrentDisplayImages();
    if (images.length === 0) {
      return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;">Aucune image</div>';
    }
    
    return `
      <div class="mobile-image-carousel">
        <div class="mobile-image-container">
          ${images.map((img, index) => `
            <div class="mobile-image-slide" data-index="${index}">
              <img src="${this.getImagePath(img)}" alt="" loading="lazy">
            </div>
          `).join('')}
        </div>
        
        ${images.length > 1 ? `
          <button class="mobile-nav-btn left">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button class="mobile-nav-btn right">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div class="mobile-image-counter" style="position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.5); color: white; padding: 0.25rem 1rem; border-radius: 2rem; font-size: 0.875rem;">
            ${this.currentImageIndex + 1}/${images.length}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  refreshDisplayedImages() {
    this.currentImageIndex = 0;
    
    const desktopRoot = this.modalElement?.querySelector('.product-images-desktop-root');
    if (desktopRoot) {
      desktopRoot.innerHTML = this.renderDesktopImages();
    }
    
    const mobileRoot = this.modalElement?.querySelector('.product-images-mobile-root');
    if (mobileRoot) {
      mobileRoot.innerHTML = this.renderMobileImages();
    }
    
    this.bindImageInteractionEvents();
    this.bindMobileNavigationEvents();
  }
  
  bindImageInteractionEvents() {
    this.modalElement?.querySelectorAll('.desktop-image-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        this.openFullscreen(index);
      });
    });
    
    this.modalElement?.querySelectorAll('.mobile-image-slide').forEach(slide => {
      slide.addEventListener('click', () => {
        const index = parseInt(slide.dataset.index, 10);
        this.openFullscreen(index);
      });
    });
  }
  
  bindMobileNavigationEvents() {
    const mobileContainer = this.modalElement?.querySelector('.mobile-image-container');
    const leftBtn = this.modalElement?.querySelector('.mobile-nav-btn.left');
    const rightBtn = this.modalElement?.querySelector('.mobile-nav-btn.right');
    
    if (mobileContainer && leftBtn && rightBtn) {
      leftBtn.addEventListener('click', () => {
        mobileContainer.scrollBy({ left: -mobileContainer.clientWidth, behavior: 'smooth' });
      });
      
      rightBtn.addEventListener('click', () => {
        mobileContainer.scrollBy({ left: mobileContainer.clientWidth, behavior: 'smooth' });
      });
      
      mobileContainer.addEventListener('scroll', () => {
        const index = Math.round(mobileContainer.scrollLeft / mobileContainer.clientWidth);
        const counter = this.modalElement.querySelector('.mobile-image-counter');
        if (counter) {
          counter.textContent = `${index + 1}/${this.getCurrentDisplayImages().length || 1}`;
        }
      });
    }
  }
  
  renderProductInfo() {
    const product = this.product;
    const displayPrice = this.getProductDisplayPrice(product);
    const variationsCount = Array.isArray(product.variations) ? product.variations.length : 0;
    
    return `
      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        <!-- Nom -->
        <h1 style="font-family: 'Cormorant Garamond', serif; font-size: 2rem; color: #1F1E1C; margin: 0;">
          ${product.name || 'Produit sans nom'}
        </h1>
        
        <!-- Description courte -->
        <p style="color: #8B7E6B; margin: 0;">
          ${product.shortDescription || ''}
        </p>
        
        <!-- Prix -->
        <div style="display: flex; align-items: baseline; gap: 1rem;">
          <span class="product-current-price" style="font-size: 2rem; font-weight: bold; color: #1F1E1C;">
            ${displayPrice.text}
          </span>
          ${product.comparePrice && variationsCount <= 1 ? `
            <span class="product-compare-price" style="font-size: 1.25rem; color: #8B7E6B; text-decoration: line-through;">
              ${this.formatPrice(product.comparePrice)}
            </span>
          ` : ''}
        </div>
        
        ${variationsCount > 0 ? `
          <div style="font-size: 0.9rem; color: #8B7E6B;">
            ${variationsCount} variation(s) disponible(s)
          </div>
        ` : ''}
        
        <!-- Options disponibles -->
        ${this.renderOptions()}

        ${variationsCount > 0 ? '' : `
          <!-- Quantité -->
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.75rem;
            border: 1px solid rgba(198, 167, 94, 0.25);
            border-radius: 0.75rem;
            background: white;
          ">
            <span style="font-weight: 500; color: #1F1E1C;">Quantité</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <button type="button" class="qty-decrease-btn" style="
                width: 32px;
                height: 32px;
                border: 1px solid rgba(198, 167, 94, 0.4);
                background: #F5F1E8;
                border-radius: 50%;
                cursor: pointer;
              "><i class="fas fa-minus"></i></button>
              <input type="number" class="qty-input" min="0" max="999" value="${this.selectedQuantity}" style="
                width: 64px;
                text-align: center;
                border: 1px solid rgba(198, 167, 94, 0.35);
                border-radius: 0.5rem;
                padding: 0.35rem;
              ">
              <button type="button" class="qty-increase-btn" style="
                width: 32px;
                height: 32px;
                border: 1px solid rgba(198, 167, 94, 0.4);
                background: #F5F1E8;
                border-radius: 50%;
                cursor: pointer;
              "><i class="fas fa-plus"></i></button>
            </div>
          </div>
        `}

        <button class="toggle-like-btn" style="
          width: 100%;
          background: white;
          color: #1F1E1C;
          padding: 0.85rem 1rem;
          border: 1px solid rgba(198, 167, 94, 0.35);
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 0.95rem;
          font-weight: 500;
          transition: all 0.2s;
        ">
          <i class="${this.likeManager?.isLiked(this.product?.id) ? 'fas' : 'far'} fa-heart" style="color:${this.likeManager?.isLiked(this.product?.id) ? '#DC2626' : '#8B7E6B'};"></i>
          <span>${this.likeManager?.isLiked(this.product?.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}</span>
        </button>
        
        <!-- Bouton Ajouter au panier -->
        <button class="add-to-cart-btn" style="
          width: 100%;
          background: #1F1E1C;
          color: #F5F1E8;
          padding: 1rem;
          border: 1px solid #C6A75E;
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 1.125rem;
          font-weight: 500;
          transition: all 0.3s;
          border: none;
        ">
          <i class="fas fa-shopping-cart"></i>
          <span>Ajouter au panier</span>
        </button>
        
        <!-- Description longue -->
        <div style="padding-top: 1rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
          <h3 style="font-weight: 500; margin-bottom: 0.5rem;">Description</h3>
          <div style="color: #8B7E6B; white-space: pre-line;">
            ${product.longDescription || 'Aucune description disponible.'}
          </div>
        </div>
      </div>
    `;
  }
  
  renderOptions() {
    const options = [];
    
    // Variations (nouvelle structure Dproducts)
    if (Array.isArray(this.product.variations) && this.product.variations.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Variations disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.variations.map((variation, index) => {
              const label = this.getVariationLabel(variation);
              const image = Array.isArray(variation?.images) ? variation.images[0] || '' : '';
              const price = this.getVariationEffectivePrice(variation, this.product);
              const qty = this.variationQuantities.get(index) || 0;
              return `
                <div class="variation-item"
                     data-type="variation"
                     data-value="${label}"
                     data-variation-index="${index}"
                     data-sku="${variation?.sku || ''}"
                     data-price="${price}"
                     data-image="${image}"
                     style="border: 2px solid ${qty > 0 ? '#C6A75E' : 'transparent'}; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: stretch; gap: 0.4rem; cursor: pointer; background: white; min-width: 170px;">
                  ${image ? `
                    <div style="width: 100%; aspect-ratio: 1 / 1; border-radius: 0.4rem; overflow: hidden; border: 1px solid rgba(198, 167, 94, 0.25); background: #F5F1E8; display: flex; align-items: center; justify-content: center; padding: 0.3rem;">
                      <img src="${this.getImagePath(image)}" alt="${label}" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\\'><i class=\\'fas fa-image\\'></i></div>';">
                    </div>
                  ` : ''}
                  <span style="font-size: 0.8rem; font-weight: 600; color: #1F1E1C;">${label}</span>
                  <span style="font-size: 0.75rem; color: #8B7E6B;">${this.formatPrice(price)}${variation?.stock !== undefined ? ` • Stock: ${variation.stock}` : ''}</span>
                  <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.25rem;">
                    <button type="button" class="variation-qty-dec" data-variation-index="${index}" style="width:26px; height:26px; border:1px solid rgba(198,167,94,0.4); background:#F5F1E8; border-radius:50%; cursor:pointer;">
                      <i class="fas fa-minus" style="font-size:0.7rem;"></i>
                    </button>
                    <span class="variation-qty" data-variation-index="${index}" style="min-width:22px; text-align:center; font-size:0.85rem; font-weight:600;">${qty}</span>
                    <button type="button" class="variation-qty-inc" data-variation-index="${index}" style="width:26px; height:26px; border:1px solid rgba(198,167,94,0.4); background:#F5F1E8; border-radius:50%; cursor:pointer;">
                      <i class="fas fa-plus" style="font-size:0.7rem;"></i>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `);
    }
    
    // Couleurs
    if (this.product.colors && this.product.colors.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Couleurs disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.colors.map((color, index) => `
              <div class="option-item" 
                   data-type="color" 
                   data-value="${color.name}"
                   data-image="${color.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                ${color.image ? `
                  <div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                    <img src="${this.getImagePath(color.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                  </div>
                ` : `
                  <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(198, 167, 94, 0.2); display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 0.875rem;">${color.name?.charAt(0)}</span>
                  </div>
                `}
                <span style="font-size: 0.75rem;">${color.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    // Tailles
    if (this.product.sizes && this.product.sizes.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Tailles disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.sizes.map((size, index) => `
              <div class="option-item" 
                   data-type="size" 
                   data-value="${size.size}"
                   data-quantity="${size.quantity || 0}"
                   data-image="${size.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer; background: white;">
                <span style="font-weight: 500;">${size.size}</span>
                <span style="font-size: 0.75rem; color: #8B7E6B;">${size.quantity || 0} dispo</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    // Options personnalisées
    if (this.product.customOptions && this.product.customOptions.length > 0) {
      this.product.customOptions.forEach(option => {
        options.push(`
          <div class="option-group">
            <h4 style="font-weight: 500; margin-bottom: 0.5rem;">${option.name}</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
              ${option.values.map(value => `
                <div class="option-item" 
                     data-type="custom" 
                     data-option="${option.name}"
                     data-value="${value.value}"
                     data-image="${value.image || ''}"
                     style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                  ${value.image ? `
                    <div style="width: 48px; height: 48px; border-radius: 0.5rem; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                      <img src="${this.getImagePath(value.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                  ` : ''}
                  <span style="font-size: 0.75rem;">${value.value}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `);
      });
    }
    
    // Mettre carré
    if (this.product.squareOption === 'yes' && this.product.squareOptions?.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Options mettre carré</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.squareOptions.map(opt => `
              <div class="option-item" 
                   data-type="square" 
                   data-value="${opt.value}"
                   data-image="${opt.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                ${opt.image ? `
                  <div style="width: 48px; height: 48px; border-radius: 0.5rem; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                    <img src="${this.getImagePath(opt.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                  </div>
                ` : ''}
                <span style="font-size: 0.75rem;">${opt.value}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    return options.length > 0 ? `
      <div style="display: flex; flex-direction: column; gap: 1rem; padding-top: 1rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
        ${options.join('')}
      </div>
    ` : '';
  }
  
  renderRelatedProducts() {
    if (this.relatedProducts.length === 0) return '';
    
    return `
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
        <h3 style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; margin-bottom: 1rem;">Vous aimerez aussi</h3>
        <div class="related-products-carousel">
          ${this.relatedProducts.map(product => `
            <div class="product-card" data-product-id="${product.id}" style="cursor: pointer; transition: transform 0.2s;">
              <div class="related-product-media">
                <img src="${this.getImagePath(this.getProductPrimaryImage(product))}" 
                     alt="" 
                     class="related-product-image"
                     loading="lazy"
                     onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #8B7E6B;\'><i class=\'fas fa-image\'></i></div>'">
              </div>
              <h4 style="font-weight: 500; font-size: 0.875rem; margin: 0 0 0.25rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${product.name || ''}</h4>
              <div style="display: flex; align-items: baseline; gap: 0.5rem;">
                <span style="font-weight: bold;">${this.getProductDisplayPrice(product).text}</span>
                ${product.comparePrice ? `
                  <span style="font-size: 0.75rem; color: #8B7E6B; text-decoration: line-through;">${this.formatPrice(product.comparePrice)}</span>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  renderError() {
    const errorHTML = `
      <div class="product-modal-overlay-${this.uniqueId}" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      ">
        <div style="
          background: #F5F1E8;
          border-radius: 1.5rem;
          padding: 2rem;
          max-width: 400px;
          text-align: center;
        ">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #7F1D1D; margin-bottom: 1rem;"></i>
          <h3 style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; margin-bottom: 0.5rem;">Produit non trouvé</h3>
          <p style="color: #8B7E6B; margin-bottom: 1.5rem;">Le produit que vous recherchez n'existe pas ou a été supprimé.</p>
          <button class="close-modal-btn" style="
            background: #1F1E1C;
            color: #F5F1E8;
            padding: 0.75rem 2rem;
            border: none;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1rem;
          " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
            Fermer
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', errorHTML);
    this.modalElement = document.querySelector(`.product-modal-overlay-${this.uniqueId}`);
    document.body.classList.add('modal-open');
  }
  
  attachEvents() {
    // Fermeture du modal
    const closeButtons = this.modalElement.querySelectorAll('.close-modal-btn');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => this.close());
    });
    
    // Clic sur l'overlay pour fermer
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) {
        this.close();
      }
    });
    
    this.bindImageInteractionEvents();
    this.bindMobileNavigationEvents();
    
    // Sélection des options
    this.modalElement.querySelectorAll('.option-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        if (type === 'variation') return;
        const group = item.closest('.option-group');
        
        // Désélectionner les autres dans le même groupe
        if (group) {
          group.querySelectorAll('.option-item').forEach(opt => {
            opt.classList.remove('selected');
            opt.style.borderColor = 'transparent';
          });
        }
        
        // Sélectionner l'option cliquée
        item.classList.add('selected');
        item.style.borderColor = '#C6A75E';
        
        // Sauvegarder la sélection
        const value = {
          type: type,
          value: item.dataset.value,
          image: item.dataset.image,
          link: item.dataset.link,
          variationIndex: item.dataset.variationIndex
        };
        
        if (type === 'custom') {
          const optionName = item.dataset.option;
          this.selectedOptions.set(`custom_${optionName}`, value);
        } else {
          this.selectedOptions.set(type, value);
        }
        
        this.saveToLocalStorage();
      });
    });

    // Sélection visuelle et preview pour variations (multi-quantités)
    this.modalElement.querySelectorAll('.variation-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        this.currentVariationIndex = idx;
        const variation = this.product?.variations?.[idx];
        const priceEl = this.modalElement.querySelector('.product-current-price');
        if (priceEl && variation) {
          priceEl.textContent = this.formatPrice(this.getVariationEffectivePrice(variation, this.product));
        }
        this.refreshDisplayedImages();
        this.modalElement.querySelectorAll(`.variation-qty[data-variation-index="${idx}"]`).forEach((el) => {
          el.textContent = String(this.variationQuantities.get(idx) || 0);
        });
        this.modalElement.querySelectorAll(`.variation-item[data-variation-index="${idx}"]`).forEach((el) => {
          el.style.borderColor = (this.variationQuantities.get(idx) || 0) > 0 ? '#C6A75E' : 'transparent';
        });
        this.saveToLocalStorage();
      });
    });

    const updateVariationQtyUI = (idx) => {
      const qty = this.variationQuantities.get(idx) || 0;
      this.modalElement.querySelectorAll(`.variation-qty[data-variation-index="${idx}"]`).forEach((el) => {
        el.textContent = String(qty);
      });
      this.modalElement.querySelectorAll(`.variation-item[data-variation-index="${idx}"]`).forEach((el) => {
        el.style.borderColor = qty > 0 ? '#C6A75E' : 'transparent';
      });
    };

    this.modalElement.querySelectorAll('.variation-qty-inc').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        const next = Math.min(999, (this.variationQuantities.get(idx) || 0) + 1);
        this.variationQuantities.set(idx, next);
        this.currentVariationIndex = idx;
        updateVariationQtyUI(idx);
        this.saveToLocalStorage();
      });
    });

    this.modalElement.querySelectorAll('.variation-qty-dec').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        const next = Math.max(0, (this.variationQuantities.get(idx) || 0) - 1);
        if (next === 0) this.variationQuantities.delete(idx);
        else this.variationQuantities.set(idx, next);
        updateVariationQtyUI(idx);
        this.saveToLocalStorage();
      });
    });
    
    // Fullscreen events
    const fullscreenImg = this.fullscreenViewer?.querySelector('.fullscreen-img');
    const closeFullscreen = this.fullscreenViewer?.querySelector('.close-fullscreen-btn');
    const prevBtn = this.fullscreenViewer?.querySelector('.fullscreen-prev');
    const nextBtn = this.fullscreenViewer?.querySelector('.fullscreen-next');
    
    if (closeFullscreen) {
      closeFullscreen.addEventListener('click', () => this.closeFullscreen());
    }
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.navigateFullscreen('prev'));
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.navigateFullscreen('next'));
    }
    
    // Ajouter au panier
    const addToCartBtns = this.modalElement.querySelectorAll('.add-to-cart-btn');
    if (addToCartBtns.length > 0) {
      let addLock = false;
      let lastTap = 0;
      addToCartBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          if (addLock || now - lastTap < 250) return;
          lastTap = now;
          addLock = true;
          this.addToCart();
          setTimeout(() => { addLock = false; }, 300);
        });
      });
    }

    const likeBtns = this.modalElement.querySelectorAll('.toggle-like-btn');
    if (likeBtns.length > 0) {
      const handleLike = async () => {
        const priceText = this.getProductDisplayPrice(this.product)?.text || '';
        const image = this.getImagePath(this.getProductPrimaryImage(this.product));
        const result = await this.likeManager.toggleLike(this.product?.id, {
          name: this.product?.name || 'Produit',
          image,
          price: priceText
        });
        if (!result?.ok && result?.reason === 'auth_required') {
          return;
        }
        this.syncLikeButton();
      };
      likeBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleLike();
        });
      });
    }

    document.addEventListener('likesUpdated', this.onLikesUpdated);

    const qtyInputs = this.modalElement.querySelectorAll('.qty-input');
    const qtyDecreaseBtns = this.modalElement.querySelectorAll('.qty-decrease-btn');
    const qtyIncreaseBtns = this.modalElement.querySelectorAll('.qty-increase-btn');
    const syncQtyInputs = () => {
      qtyInputs.forEach((input) => {
        input.value = String(this.selectedQuantity);
      });
    };

    qtyDecreaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedQuantity = Math.max(0, Number(this.selectedQuantity || 0) - 1);
        syncQtyInputs();
        this.saveToLocalStorage();
      });
    });
    qtyIncreaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedQuantity = Math.min(999, Number(this.selectedQuantity || 0) + 1);
        syncQtyInputs();
        this.saveToLocalStorage();
      });
    });
    qtyInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const parsed = parseInt(input.value, 10);
        this.selectedQuantity = Number.isFinite(parsed) ? Math.min(999, Math.max(0, parsed)) : 0;
        syncQtyInputs();
        this.saveToLocalStorage();
      });
      input.addEventListener('blur', syncQtyInputs);
    });
    
    // Produits liés
    this.modalElement.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => {
        const productId = card.dataset.productId;
        if (productId) {
          this.close();
          // Émettre un événement personnalisé pour ouvrir le nouveau produit
          const event = new CustomEvent('openProductModal', { detail: { productId } });
          document.dispatchEvent(event);
        }
      });
    });
    
    // Touche Echap pour fermer
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.isFullscreen) {
          this.closeFullscreen();
        } else {
          this.close();
        }
      }
    });
  }
  
  openFullscreen(index) {
    this.isFullscreen = true;
    this.fullscreenIndex = index;
    const images = this.getCurrentDisplayImages();
    
    const img = this.fullscreenViewer.querySelector('.fullscreen-img');
    const counter = this.fullscreenViewer.querySelector('.fullscreen-counter');
    
    img.src = this.getImagePath(images[index]);
    counter.textContent = `${index + 1}/${images.length}`;
    
    this.fullscreenViewer.style.display = 'flex';
    
    // Désactiver le scroll du body (déjà fait mais on renforce)
    document.body.style.overflow = 'hidden';
  }
  
  closeFullscreen() {
    this.isFullscreen = false;
    this.fullscreenViewer.style.display = 'none';
  }
  
  navigateFullscreen(direction) {
    const images = this.getCurrentDisplayImages();
    if (direction === 'prev') {
      this.fullscreenIndex = (this.fullscreenIndex - 1 + images.length) % images.length;
    } else {
      this.fullscreenIndex = (this.fullscreenIndex + 1) % images.length;
    }
    
    const img = this.fullscreenViewer.querySelector('.fullscreen-img');
    const counter = this.fullscreenViewer.querySelector('.fullscreen-counter');
    
    img.src = this.getImagePath(images[this.fullscreenIndex]);
    counter.textContent = `${this.fullscreenIndex + 1}/${images.length}`;
  }
  
  saveToLocalStorage() {
    if (!this.product?.id) return;
    const key = `veltrixa_modal_selection_${this.product.id}`;
    const payload = {
      selectedOptions: Array.from(this.selectedOptions.entries()),
      selectedQuantity: Math.max(0, Number(this.selectedQuantity) || 0),
      variationQuantities: Array.from(this.variationQuantities.entries()),
      currentVariationIndex: Number(this.currentVariationIndex) || 0,
      updatedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(payload));
  }
  
  loadFromLocalStorage() {
    if (!this.product?.id) return;
    const key = `veltrixa_modal_selection_${this.product.id}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved || !Array.isArray(saved.selectedOptions)) return;

    saved.selectedOptions.forEach(([k, v]) => {
      this.selectedOptions.set(k, v);
    });
    this.selectedQuantity = Math.max(0, Number(saved.selectedQuantity) || 0);
    this.variationQuantities = new Map(
      (Array.isArray(saved.variationQuantities) ? saved.variationQuantities : [])
        .map(([idx, qty]) => [Number(idx), Math.max(0, Number(qty) || 0)])
        .filter(([idx, qty]) => Number.isInteger(idx) && qty > 0)
    );

    setTimeout(() => {
      saved.selectedOptions.forEach(([keyName, value]) => {
        const selector = `[data-type="${keyName.split('_')[0]}"][data-value="${value?.value}"]`;
        const option = this.modalElement.querySelector(selector);
        if (option) {
          option.classList.add('selected');
          option.style.borderColor = '#C6A75E';
        }
      });

      const variation = this.selectedOptions.get('variation');
      const variationIndex = Number(variation?.variationIndex);
      if (Number.isInteger(variationIndex)) {
        this.currentVariationIndex = variationIndex;
        const variationData = this.product?.variations?.[variationIndex];
        const priceEl = this.modalElement.querySelector('.product-current-price');
        if (priceEl && variationData) {
          priceEl.textContent = this.formatPrice(this.getVariationEffectivePrice(variationData, this.product));
        }
        this.refreshDisplayedImages();
      }

      this.variationQuantities.forEach((qty, idx) => {
        this.modalElement.querySelectorAll(`.variation-qty[data-variation-index="${idx}"]`).forEach((el) => {
          el.textContent = String(Math.max(0, Number(qty) || 0));
        });
        this.modalElement.querySelectorAll(`.variation-item[data-variation-index="${idx}"]`).forEach((el) => {
          el.style.borderColor = (Number(qty) || 0) > 0 ? '#C6A75E' : 'transparent';
        });
      });

      this.modalElement.querySelectorAll('.qty-input').forEach((input) => {
        input.value = String(this.selectedQuantity);
      });
    }, 100);
  }
  
 addToCart() {
  // Récupérer l'instance du panier
  import('./cart.js').then(({ getCartManager }) => {
    const cart = getCartManager();
    
    // Collecter les images des options sélectionnées
    const selectedOptionsWithImages = Array.from(this.selectedOptions.entries())
      .filter(([key]) => key !== 'variation')
      .map(([key, value]) => {
      return {
        type: key,
        value: value.value || value,
        image: value.image || '', // Image de l'option
        link: value.link || '',
        variationIndex: value.variationIndex
      };
    });
    
    let entries = Array.from(this.variationQuantities.entries())
      .map(([idx, qty]) => [Number(idx), Math.max(0, Number(qty) || 0)])
      .filter(([idx, qty]) => Number.isInteger(idx) && qty > 0);

    let hasAddedItem = false;

    if (Array.isArray(this.product?.variations) && this.product.variations.length > 0) {
      if (entries.length === 0) {
        const fallbackIdx = Number.isInteger(this.currentVariationIndex) ? this.currentVariationIndex : 0;
        const fallbackQty = Math.max(0, Number(this.selectedQuantity) || 0);
        if (fallbackQty > 0) {
          entries = [[fallbackIdx, fallbackQty]];
        }
      }
      if (entries.length === 0) {
        return;
      }
      entries.forEach(([variationIndex, quantity]) => {
        const variationData = this.product?.variations?.[variationIndex];
        if (!variationData) return;
        const finalPrice = this.getVariationEffectivePrice(variationData, this.product);
        const finalImage = variationData?.images?.[0] || this.getProductPrimaryImage(this.product);
        const finalSku = variationData?.sku || this.product.sku || '';
        const variationLabel = this.getVariationLabel(variationData);

        const item = {
          productId: this.product.id,
          sku: finalSku,
          name: this.product.name,
          price: finalPrice,
          image: finalImage,
          selectedOptions: [
            ...selectedOptionsWithImages,
            {
              type: 'variation',
              value: variationLabel,
              image: finalImage,
              variationIndex
            }
          ],
          quantity,
          timestamp: Date.now()
        };

        if (cart && typeof cart.addItem === 'function') {
          cart.addItem(item);
        } else {
          const event = new CustomEvent('addToCart', { detail: item });
          document.dispatchEvent(event);
        }
        hasAddedItem = true;
      });
    } else {
      const variationData = this.product?.variations?.[this.currentVariationIndex] || null;
      const finalPrice = this.getVariationEffectivePrice(variationData, this.product);
      const finalImage = variationData?.images?.[0] || this.getProductPrimaryImage(this.product);
      const finalSku = variationData?.sku || this.product.sku || '';
      const quantity = Math.max(0, Number(this.selectedQuantity) || 0);
      if (quantity <= 0) {
        return;
      }
      const item = {
        productId: this.product.id,
        sku: finalSku,
        name: this.product.name,
        price: finalPrice,
        image: finalImage,
        selectedOptions: selectedOptionsWithImages,
        quantity,
        timestamp: Date.now()
      };
      if (cart && typeof cart.addItem === 'function') {
        cart.addItem(item);
      } else {
        const event = new CustomEvent('addToCart', { detail: item });
        document.dispatchEvent(event);
      }
      hasAddedItem = true;
    }

    if (!hasAddedItem) return;
    
    // Animation de confirmation
    const btns = this.modalElement.querySelectorAll('.add-to-cart-btn');
    btns.forEach((btn) => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Ajouté !';
      btn.style.background = '#2E5D3A';
      btn.style.color = 'white';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '#1F1E1C';
        btn.style.color = '#F5F1E8';
      }, 2000);
    });
  });
}
  
  getCartCount() {
    const cart = JSON.parse(localStorage.getItem('veltrixa_cart') || '[]');
    return cart.reduce((total, item) => total + (item.quantity || 1), 0);
  }

  syncLikeButton() {
    if (!this.modalElement || !this.product?.id || !this.likeManager) return;
    const liked = this.likeManager.isLiked(this.product.id);
    this.modalElement.querySelectorAll('.toggle-like-btn').forEach((btn) => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');
      if (icon) {
        icon.className = `${liked ? 'fas' : 'far'} fa-heart`;
        icon.style.color = liked ? '#DC2626' : '#8B7E6B';
      }
      if (label) {
        label.textContent = liked ? 'Retirer des favoris' : 'Ajouter aux favoris';
      }
    });
  }
  
  animateIn() {
    if (typeof anime !== 'undefined') {
      anime({
        targets: `.product-modal-container-${this.uniqueId}`,
        scale: [0.9, 1],
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutQuad'
      });
    }
  }
  
  animateOut() {
    return new Promise(resolve => {
      if (typeof anime !== 'undefined') {
        anime({
          targets: `.product-modal-overlay-${this.uniqueId}`,
          opacity: [1, 0],
          duration: 200,
          easing: 'easeInQuad',
          complete: resolve
        });
      } else {
        resolve();
      }
    });
  }
  
  async close() {
    await this.animateOut();
    document.removeEventListener('likesUpdated', this.onLikesUpdated);
    this.modalElement?.remove();
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
}

export default ProductModal;
