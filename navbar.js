// ============= NAVBAR.JS AVEC THÈME - VERSION NOUVELLE STRUCTURE =============
import { db } from './firebase-init.js';
import { collection, query, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';
import MegaMenu from './mega-menu.js';
import MobileMenu from './mobile-menu.js';
import { getSearchManager } from './search.js';

class Navbar {
  constructor(options = {}) {
    this.options = {
      desktopContainerId: options.desktopContainerId || 'desktopCategoriesContainer',
      mobileContainerId: options.mobileContainerId || 'mobileCategoryCarousel',
      ...options
    };
    
    this.config = null;
    this.categories = [];
    this.desktopCategories = [];
    this.mobileCategories = [];
    this.theme = theme;
    this.megaMenu = new MegaMenu();
    this.mobileMenu = new MobileMenu();
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe((themeData) => {
      this.applyTheme(themeData);
    });
    
    this.init();
  }
  
  applyTheme(themeData) {
    const colors = themeData.colors;
    const fonts = themeData.fonts;
    
    // Couleurs de texte
    if (colors?.text?.title) {
      document.documentElement.style.setProperty('--text-title', colors.text.title);
    }
    if (colors?.text?.subtitle) {
      document.documentElement.style.setProperty('--text-subtitle', colors.text.subtitle);
    }
    if (colors?.text?.body) {
      document.documentElement.style.setProperty('--text-body', colors.text.body);
    }
    if (colors?.text?.button) {
      document.documentElement.style.setProperty('--text-button', colors.text.button);
    }
    
    // Couleurs de fond
    if (colors?.background?.general) {
      document.documentElement.style.setProperty('--bg-general', colors.background.general);
    }
    if (colors?.background?.card) {
      document.documentElement.style.setProperty('--bg-card', colors.background.card);
    }
    if (colors?.background?.button) {
      document.documentElement.style.setProperty('--bg-button', colors.background.button);
    }
    
    // Couleurs d'icônes
    if (colors?.icon?.standard) {
      document.documentElement.style.setProperty('--icon-standard', colors.icon.standard);
      // Appliquer directement aux icônes
      document.querySelectorAll('.desktop-icon, .mobile-icon').forEach(icon => {
        icon.style.color = colors.icon.standard;
      });
    }
    if (colors?.icon?.hover) {
      document.documentElement.style.setProperty('--icon-hover', colors.icon.hover);
      // Ajouter le style hover via une feuille de style
      this.addHoverStyles(colors.icon.hover);
    }
    
    // Polices
    if (fonts?.primary) {
      document.documentElement.style.setProperty('--font-primary', fonts.primary);
    }
    if (fonts?.secondary) {
      document.documentElement.style.setProperty('--font-secondary', fonts.secondary);
    }
    
    // Compatibilité avec anciennes variables
    if (colors?.text?.title) {
      document.documentElement.style.setProperty('--primary-color', colors.text.title);
    }
    if (colors?.background?.button) {
      document.documentElement.style.setProperty('--secondary-color', colors.background.button);
    }
    if (colors?.text?.subtitle) {
      document.documentElement.style.setProperty('--accent-color', colors.text.subtitle);
    }
  }
  
  addHoverStyles(iconHoverColor) {
    // Supprimer l'ancien style s'il existe
    const oldStyle = document.getElementById('navbar-hover-styles');
    if (oldStyle) oldStyle.remove();
    
    // Créer un nouveau style pour les survols
    const style = document.createElement('style');
    style.id = 'navbar-hover-styles';
    style.textContent = `
      .desktop-icon:hover, .mobile-icon:hover {
        color: ${iconHoverColor} !important;
        transition: color 0.3s ease;
      }
      
      .categoryTriggerLux77:hover {
        border-bottom-color: ${iconHoverColor} !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  init() {
    this.loadCategories();
    this.setupCartEvents();
    this.initSearch();
    
    // Appliquer le thème initial
    const colors = this.theme.getColors();
    const fonts = this.theme.getFonts();
    if (colors || fonts) {
      this.applyTheme({
        colors,
        fonts,
        typography: this.theme.getTypography()
      });
    }
  }
  
  initSearch() {
    getSearchManager({
      triggerSelector: '.desktop-icon.search-trigger, .mobile-icon.search-trigger, #desktopSearchIcon, #mobileSearchIcon',
      imageBasePath: this.options.imageBasePath || './'
    });
    
  }
  
  applyConfig(config) {
    this.config = config;
    
    // Logo
    const desktopLogo = document.getElementById('desktopLogoImg');
    const mobileLogo = document.getElementById('mobileLogoImg');
    const desktopCompany = document.getElementById('desktopCompanyName');
    
    if (config.logoUrl) {
      desktopLogo.src = config.logoUrl;
      mobileLogo.src = config.logoUrl;
      desktopLogo.style.display = 'block';
      mobileLogo.style.display = 'block';
    }
    
    if (desktopCompany) {
      desktopCompany.textContent = config.companyName || 'Vitch Studio';
    }
    
    // Icônes
    const hamburger = document.getElementById('mobileHamburgerBtn');
    if (hamburger) {
      hamburger.className = `mobile-hamburger ${config.primaryIconHamburger || 'fas fa-bars'}`;
      
      // Appliquer la couleur des icônes
      const colors = this.theme.getColors();
      if (colors?.icon?.standard) {
        hamburger.style.color = colors.icon.standard;
      }
    }
    
    const searchIcon = document.getElementById('desktopSearchIcon');
    const mobileSearchIcon = document.getElementById('mobileSearchIcon');
    const searchIconClass = config.primaryIconSearch || 'fas fa-search';
    
    const colors = this.theme.getColors();
    
    if (searchIcon) {
      searchIcon.className = `${searchIconClass} desktop-icon search-trigger`;
      if (colors?.icon?.standard) {
        searchIcon.style.color = colors.icon.standard;
      }
    }
    if (mobileSearchIcon) {
      mobileSearchIcon.className = `${searchIconClass} mobile-icon search-trigger`;
      if (colors?.icon?.standard) {
        mobileSearchIcon.style.color = colors.icon.standard;
      }
    }
    
    const cartIcon = document.getElementById('desktopCartIcon');
    const mobileCartIcon = document.getElementById('mobileCartIcon');
    const cartIconClass = config.primaryIconCart || 'fas fa-shopping-bag';
    
    if (cartIcon) {
      cartIcon.className = `${cartIconClass} desktop-icon`;
      if (colors?.icon?.standard) {
        cartIcon.style.color = colors.icon.standard;
      }
    }
    if (mobileCartIcon) {
      mobileCartIcon.className = `${cartIconClass} mobile-icon`;
      if (colors?.icon?.standard) {
        mobileCartIcon.style.color = colors.icon.standard;
      }
    }
  }
  
  loadCategories() {
    try {
      const categoriesRef = collection(db, 'categories_list');
      const q = query(categoriesRef);
      
      onSnapshot(q, (snapshot) => {
        this.categories = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            name: data.name || 'Sans nom',
            order: data.order || 0,
            image: data.image || null,
            description: data.description || null,
            ...data
          };
        });
        
        this.categories.sort((a, b) => (a.order || 0) - (b.order || 0));
        this.desktopCategories = this.categories.filter((cat) => cat.showInHeader !== false);
        this.mobileCategories = [...this.categories];
        
        
        this.renderDesktopCategories();
        this.mobileMenu.setCategories(this.mobileCategories);
      }, (error) => {
        console.error("❌ Erreur chargement catégories depuis categories_list:", error);
      });
    } catch (error) {
      console.error("❌ Erreur dans loadCategories:", error);
    }
  }
  
  renderDesktopCategories() {
    const container = document.getElementById(this.options.desktopContainerId);
    if (!container) return;
    
    if (this.desktopCategories.length === 0) {
      container.innerHTML = '<span style="color: #999;">Aucune catégorie</span>';
      return;
    }
    
    container.innerHTML = '';
    
    const colors = this.theme.getColors();
    const iconHoverColor = colors?.icon?.hover || '#C6A75E';
    
    this.desktopCategories.forEach(cat => {
      const catEl = document.createElement('span');
      catEl.className = 'categoryTriggerLux77';
      catEl.textContent = cat.name;
      catEl.setAttribute('data-category-id', cat.id);
      
      if (cat.image) {
        catEl.setAttribute('data-category-image', cat.image);
      }
      
      // Ajouter le style avec la couleur de survol
      catEl.style.transition = 'border-bottom-color 0.3s ease, color 0.3s ease';
      
      catEl.addEventListener('mouseenter', () => {
        catEl.style.borderBottomColor = iconHoverColor;
        catEl.style.color = iconHoverColor;
        this.megaMenu.open(cat.id);
      });
      
      catEl.addEventListener('mouseleave', () => {
        catEl.style.borderBottomColor = 'transparent';
        catEl.style.color = '';
      });
      
      container.appendChild(catEl);
    });
  }
  
  setupCartEvents() {
    const desktopCart = document.getElementById('desktopCartIcon');
    const mobileCart = document.getElementById('mobileCartIcon');
    
    if (desktopCart) {
      desktopCart.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openCart();
      });
    }
    
    if (mobileCart) {
      mobileCart.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openCart();
      });
    }
  }
  
  openCart() {
    const event = new Event('openCart');
    document.dispatchEvent(event);
  }
  
  updateCartCount(count) {
    const event = new CustomEvent('cartCountUpdated', { detail: { count } });
    document.dispatchEvent(event);
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
  }
}

export default Navbar;
