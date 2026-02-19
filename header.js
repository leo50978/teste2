import { db } from './firebase-init.js';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import './search.js';
import Navbar from './navbar.js';
import AnnouncementBar from './announcement-bar.js';
import { getCartManager } from './cart.js';

class SierraHeaderNebula {
  constructor(containerId = 'sierra-header-root') {
    this.containerId = containerId;
    this.navbar = null;
    this.announcementBar = null;
    this.cartManager = null;

    this.injectStyles();
    this.render();
    this.init();
  }

  injectStyles() {
    const styleId = 'sierra-header-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      :root {
        --primary-color: #3a4e3f;
        --secondary-color: #b89b7b;
        --accent-color: #7c3e3e;
        --primary-font: 'Cormorant Garamond', serif;
        --brand-font: 'Playfair Display', 'Cormorant Garamond', serif;
        --secondary-font: 'Manrope', sans-serif;
        --announce-height: 44px;
        --header-height: 90px;
        --header-height-mobile: 70px;
      }

      #headerNebulaX92 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 1000;
        transition: transform 0.35s ease, background 0.3s ease, box-shadow 0.3s ease;
        font-family: var(--secondary-font);
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(14px);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(184, 155, 123, 0.08);
      }

      .header-transparent {
        background: rgba(255, 255, 255, 0.88);
        backdrop-filter: blur(14px);
      }

      .header-solid {
        background: rgba(255, 255, 255, 0.96);
        backdrop-filter: blur(12px);
        box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.03), 0 0 0 1px rgba(184, 155, 123, 0.08);
      }

      #announcementBarVega33 {
        height: var(--announce-height);
      }

      .desktop-header-inner {
        max-width: 1440px;
        margin: 0 auto;
        padding: 0 2.5rem;
        height: var(--header-height);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .desktop-left {
        display: flex;
        align-items: center;
        gap: 2rem;
      }

      .desktop-logo-area {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .desktop-logo {
        height: 54px;
        width: auto;
        object-fit: contain;
      }

      .desktop-company-name {
        font-family: var(--brand-font);
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #141414;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
      }

      .desktop-categories {
        display: flex;
        gap: 2.2rem;
        margin-left: 1rem;
      }

      .categoryTriggerLux77 {
        font-size: 0.95rem;
        font-weight: 500;
        color: #1e1e1e;
        padding: 0.6rem 0;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.25s ease;
      }

      .desktop-icons {
        display: flex;
        gap: 1.8rem;
        align-items: center;
      }

      .desktop-icon,
      .mobile-icon {
        font-size: 1.35rem;
        color: #1e1e1e;
        cursor: pointer;
        transition: all 0.25s ease;
      }

      .desktop-icon:hover,
      .mobile-icon:hover {
        transform: scale(1.06);
      }

      .mobile-header-inner {
        display: none;
        height: var(--header-height-mobile);
        align-items: center;
        justify-content: space-between;
        padding: 0 1.25rem;
        position: relative;
      }

      .mobile-left-group {
        display: flex;
        align-items: center;
        width: 40px;
      }

      .mobile-hamburger {
        font-size: 1.6rem;
        color: #1e1e1e;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mobile-logo-center {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mobile-logo {
        height: 42px;
        width: auto;
        object-fit: contain;
      }

      .mobile-right-group {
        display: flex;
        align-items: center;
        gap: 1.25rem;
        width: 80px;
        justify-content: flex-end;
      }

      #megaPortalLux21 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(16px);
        z-index: 999;
        display: none;
        opacity: 0;
        transition: opacity 0.4s ease;
        overflow-y: auto;
      }

      .mega-content {
        max-width: 1400px;
        margin: 100px auto 0;
        padding: 2rem 4rem;
        display: grid;
        grid-template-columns: 1fr 380px;
        gap: 4rem;
      }

      .mega-columns-area {
        display: flex;
        gap: 3.5rem;
        flex-wrap: wrap;
      }

      .mega-column {
        min-width: 200px;
      }

      .mega-column-title {
        font-family: var(--primary-font);
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 1rem;
        border-bottom: 1px solid var(--secondary-color);
        padding-bottom: 0.45rem;
      }

      .mega-lines {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .mega-line {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.45rem 0.6rem;
        border-radius: 12px;
        text-decoration: none;
        cursor: pointer;
      }

      .mega-line-image {
        width: 32px;
        height: 32px;
        min-width: 32px;
        border-radius: 8px;
        object-fit: cover;
      }

      .mega-featured-products {
        background: rgba(184, 155, 123, 0.06);
        border-radius: 28px;
        padding: 2rem;
      }

      .featured-grid {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .mega-close-btn {
        position: fixed;
        top: 58px;
        right: 28px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid rgba(184, 155, 123, 0.4);
        background: #fff;
        font-size: 1.35rem;
        cursor: pointer;
        z-index: 1001;
      }

      #mobileMenuFullscreenOrion99 {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: white;
        z-index: 2000;
        display: none;
        opacity: 0;
        transition: opacity 0.4s ease;
        overflow-y: auto;
      }

      .mobile-menu-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 1.8rem;
        border-bottom: 1px solid rgba(184, 155, 123, 0.15);
        margin-bottom: 1.5rem;
      }

      .mobile-menu-title {
        font-family: var(--primary-font);
        font-size: 1.6rem;
        font-weight: 600;
      }

      .mobile-menu-close {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid rgba(184, 155, 123, 0.35);
        background: #fff;
        font-size: 1.15rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .mobile-categories-section,
      .mobile-columns-section,
      #mobileLinesLevel {
        padding: 0 1.8rem;
      }

      .mobile-category-carousel {
        display: flex;
        gap: 1.2rem;
        overflow-x: auto;
        padding-bottom: 1.2rem;
        margin-bottom: 1rem;
        scrollbar-width: none;
      }

      .mobile-category-carousel::-webkit-scrollbar {
        display: none;
      }

      .mobile-category-card {
        flex: 0 0 108px;
        text-align: center;
        cursor: pointer;
      }

      .mobile-category-image {
        width: 88px;
        height: 88px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(184, 155, 123, 0.45);
        margin: 0 auto 0.5rem;
        display: block;
      }

      .mobile-category-name {
        font-size: 0.82rem;
        line-height: 1.2;
        color: #1f1e1c;
      }

      .mobile-back-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        font-size: 1.6rem;
        border-radius: 50%;
        cursor: pointer;
      }

      #mobileMenuContent {
        padding-bottom: 6.2rem;
      }

      .mobile-menu-footer {
        position: sticky;
        bottom: 0;
        z-index: 4;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 0.65rem 1rem;
        padding: 0.85rem 1.2rem;
        border-top: 1px solid rgba(184, 155, 123, 0.22);
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(10px);
      }

      .mobile-footer-brand {
        font-family: var(--brand-font);
        font-size: 0.92rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .mobile-footer-sub {
        font-size: 0.76rem;
        color: #6d665f;
      }

      .mobile-footer-close-btn {
        border: 1px solid rgba(184, 155, 123, 0.45);
        background: #fff;
        border-radius: 999px;
        padding: 0.52rem 0.92rem;
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
      }

      .mobile-footer-links {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        gap: 0.45rem 0.6rem;
      }

      .mobile-footer-link {
        font-size: 0.74rem;
        color: #2a2825;
        text-decoration: none;
        border: 1px solid rgba(184, 155, 123, 0.35);
        background: rgba(255, 255, 255, 0.9);
        border-radius: 999px;
        padding: 0.26rem 0.62rem;
      }

      .mobile-footer-link:hover {
        background: rgba(198, 167, 94, 0.14);
      }

      @media (max-width: 1024px) {
        .desktop-header-inner { display: none !important; }
        .mobile-header-inner { display: flex !important; }
      }

      @media (min-width: 1025px) {
        .desktop-header-inner { display: flex !important; }
        .mobile-header-inner { display: none !important; }
      }
    `;

    document.head.appendChild(style);
  }

  render() {
    const headerRoot = document.getElementById(this.containerId);
    if (!headerRoot) {
      console.error(`❌ #${this.containerId} not found`);
      return;
    }

    headerRoot.innerHTML = `
      <header id="headerNebulaX92" class="header-solid">
        <div id="announcementBarVega33"></div>

        <div class="desktop-header-inner">
          <div class="desktop-left">
            <div class="desktop-logo-area">
              <img id="desktopLogoImg" class="desktop-logo" src="" alt="logo" style="display: none;">
              <span id="desktopCompanyName" class="desktop-company-name">Vitch Studio</span>
            </div>
            <div id="desktopCategoriesContainer" class="desktop-categories"></div>
          </div>
          <div class="desktop-icons">
            <i id="desktopSearchIcon" class="fas fa-search desktop-icon search-trigger"></i>
            <i id="desktopCartIcon" class="fas fa-shopping-bag desktop-icon"></i>
          </div>
        </div>

        <div class="mobile-header-inner">
          <div class="mobile-left-group">
            <i id="mobileHamburgerBtn" class="mobile-hamburger fas fa-bars"></i>
          </div>
          <div class="mobile-logo-center">
            <img id="mobileLogoImg" class="mobile-logo" src="" alt="logo" style="display: none;">
          </div>
          <div class="mobile-right-group">
            <i id="mobileSearchIcon" class="fas fa-search mobile-icon search-trigger"></i>
            <i id="mobileCartIcon" class="fas fa-shopping-bag mobile-icon"></i>
          </div>
        </div>
      </header>

      <div id="megaPortalLux21">
        <button id="megaCloseBtn" class="mega-close-btn" aria-label="Fermer le menu">
          <i class="fas fa-times"></i>
        </button>
        <div class="mega-content">
          <div id="megaColumnsContainer" class="mega-columns-area"></div>
          <div class="mega-featured-products">
            <h3 style="font-family: var(--primary-font); font-size: 1.3rem; margin-bottom: 1rem;">Sélection Prestige</h3>
            <div id="featuredProductsGrid" class="featured-grid"></div>
          </div>
        </div>
      </div>

      <div id="mobileMenuFullscreenOrion99">
        <div class="mobile-menu-header">
          <span class="mobile-menu-title">Catégories</span>
          <button id="closeMobileMenuBtn" class="mobile-menu-close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div id="mobileMenuContent">
          <div id="mobileCategoriesLevel" class="mobile-categories-section">
            <div id="mobileCategoryCarousel" class="mobile-category-carousel"></div>
          </div>

          <div id="mobileColumnsLevel" style="display: none;">
            <div style="padding: 0 1.8rem; display: flex; align-items: center; gap: 1rem;">
              <i id="mobileBackToCategoriesArrow" class="fas fa-arrow-left mobile-back-arrow"></i>
              <h3 id="mobileCurrentCategoryTitle" style="font-family: var(--primary-font); font-size: 1.4rem; font-weight: 600; margin: 0;"></h3>
            </div>
            <div id="mobileColumnsContainer" class="mobile-columns-section"></div>
            <div id="mobileFeaturedColumns" class="mobile-columns-section"></div>
          </div>

          <div id="mobileLinesLevel" style="display: none;">
            <div style="padding: 0 1.8rem; display: flex; align-items: center; gap: 1rem;">
              <i id="mobileBackToColumnsArrow" class="fas fa-arrow-left mobile-back-arrow"></i>
              <h3 id="mobileCurrentLineTitle" style="font-family: var(--primary-font); font-size: 1.4rem; font-weight: 600; margin: 0;"></h3>
            </div>
            <div id="mobileLinesContainer" class="mobile-columns-section"></div>
          </div>
        </div>

        <div class="mobile-menu-footer">
          <div>
            <div class="mobile-footer-brand">Vitch Studio</div>
            <div class="mobile-footer-sub">Service client premium</div>
          </div>
          <button id="mobileMenuFooterCloseBtn" class="mobile-footer-close-btn" type="button">
            Fermer <i class="fas fa-times" style="margin-left: 0.35rem;"></i>
          </button>
          <div id="mobileFooterLinksContainer" class="mobile-footer-links"></div>
        </div>
      </div>
    `;
  }

  async init() {
    this.announcementBar = new AnnouncementBar({
      containerId: 'announcementBarVega33',
      textContainerId: 'announcementTextContainer'
    });

    this.navbar = new Navbar({
      desktopContainerId: 'desktopCategoriesContainer',
      mobileContainerId: 'mobileCategoryCarousel'
    });

    // Singleton: n'instancie qu'une seule fois le gestionnaire panier.
    this.cartManager = getCartManager({
      imageBasePath: './'
    });

    await this.applyHeaderConfig();
    await this.loadMobileFooterLinks();
    this.setupScrollBehavior();
  }

  async loadMobileFooterLinks() {
    const linksContainer = document.getElementById('mobileFooterLinksContainer');
    if (!linksContainer) return;

    try {
      const infoQuery = query(collection(db, 'footerInfos'), orderBy('createdAt', 'asc'));
      const infoSnap = await getDocs(infoQuery);
      const infos = infoSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.active !== false && row.title && row.link);

      if (!infos.length) {
        linksContainer.innerHTML = '';
        return;
      }

      linksContainer.innerHTML = infos.map((item) => {
        const href = item.link || '#';
        const isExternal = /^https?:\/\//i.test(href);
        return `
          <a class="mobile-footer-link" href="${href}" ${isExternal ? 'target="_blank" rel="noopener noreferrer"' : ''}>
            ${item.title}
          </a>
        `;
      }).join('');
    } catch (error) {
      console.error('❌ Erreur chargement liens footer mobile:', error);
      linksContainer.innerHTML = '';
    }
  }

  async applyHeaderConfig() {
    try {
      const configRef = doc(db, 'headerConfig', 'sierraHeaderGlobal');
      const configSnap = await getDoc(configRef);

      if (!configSnap.exists()) return;

      const config = configSnap.data() || {};

      if (config.primaryColor) {
        document.documentElement.style.setProperty('--primary-color', config.primaryColor);
      }
      if (config.secondaryColor) {
        document.documentElement.style.setProperty('--secondary-color', config.secondaryColor);
      }
      if (config.accentColor) {
        document.documentElement.style.setProperty('--accent-color', config.accentColor);
      }

      if (this.navbar && typeof this.navbar.applyConfig === 'function') {
        this.navbar.applyConfig(config);
      }
    } catch (error) {
      console.error('❌ Erreur chargement config header:', error);
    }
  }

  setupScrollBehavior() {
    const header = document.getElementById('headerNebulaX92');
    if (!header) return;

    let lastScrollY = window.scrollY;
    let ticking = false;

    const onScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY;

        header.classList.remove('header-transparent');
        header.classList.add('header-solid');

        if (currentScrollY > lastScrollY && currentScrollY > 150) {
          header.style.transform = 'translateY(-100%)';
        } else {
          header.style.transform = 'translateY(0)';
        }

        lastScrollY = currentScrollY;
        ticking = false;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
  }

  destroy() {
    if (this.navbar?.destroy) this.navbar.destroy();
    if (this.announcementBar?.destroy) this.announcementBar.destroy();
  }
}

export default SierraHeaderNebula;
