// ============= ANNOUNCEMENT-BAR.JS - VERSION AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { collection, query, where, orderBy, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';

class AnnouncementBar {
  constructor(options = {}) {
    this.options = {
      containerId: options.containerId || 'announcementBarVega33',
      textContainerId: options.textContainerId || 'announcementTextContainer',
      ...options
    };
    
    this.announcements = [];
    this.currentIndex = 0;
    this.interval = null;
    this.theme = theme;
    
    this.container = document.getElementById(this.options.containerId);
    this.textContainer = document.getElementById(this.options.textContainerId);
    
    if (!this.container) {
      console.error("❌ AnnouncementBar: Container non trouvé");
      return;
    }
    
    this.unsubscribeTheme = this.theme.subscribe((themeData) => {
      this.applyTheme(themeData);
    });
    
    this.createArrowContainer();
    this.init();
  }
  
  applyTheme(themeData) {
    if (!this.container) return;
    
    const colors = themeData.colors;
    
    // BACKGROUND - Utilise background.general
    if (colors?.background?.general) {
      this.container.style.backgroundColor = colors.background.general;
    }
    
    // TEXT - Utilise text.body pour le texte des annonces
    const textColor = colors?.text?.title || '#FFFFFF';
    
    // Mettre à jour le texte
    const textElements = this.container.querySelectorAll('.announcement-text');
    textElements.forEach(el => {
      el.style.color = textColor;
    });
    
    // ICONS - Utilise icon.standard et icon.hover
    const arrows = this.container.querySelectorAll('.announcement-nav-arrow');
    arrows.forEach(arrow => {
      // Couleur de l'icône
      arrow.style.color = textColor;
      
      // Fond de l'icône - utilise icon.standard
      const iconBg = colors?.icon?.standard || 'rgba(255,255,255,0.2)';
      arrow.style.backgroundColor = iconBg;
      
      // Stocker les couleurs pour le survol
      const iconHoverBg = colors?.icon?.hover || iconBg;
      
      // Remplacer les event listeners
      const newEnterHandler = () => {
        arrow.style.opacity = '1';
        arrow.style.backgroundColor = iconHoverBg;
        arrow.style.transform = 'translateY(-50%) scale(1.05)';
      };
      
      const newLeaveHandler = () => {
        arrow.style.opacity = '0.7';
        arrow.style.backgroundColor = iconBg;
        arrow.style.transform = 'translateY(-50%) scale(1)';
      };
      
      // Nettoyer les anciens listeners
      if (arrow._enterHandler) {
        arrow.removeEventListener('mouseenter', arrow._enterHandler);
      }
      if (arrow._leaveHandler) {
        arrow.removeEventListener('mouseleave', arrow._leaveHandler);
      }
      
      // Ajouter les nouveaux
      arrow.addEventListener('mouseenter', newEnterHandler);
      arrow.addEventListener('mouseleave', newLeaveHandler);
      
      arrow._enterHandler = newEnterHandler;
      arrow._leaveHandler = newLeaveHandler;
    });
  }
  
  createArrowContainer() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';
    this.container.style.display = 'flex';
    this.container.style.alignItems = 'center';
    this.container.style.justifyContent = 'center';
    this.container.style.height = '44px';
    this.container.style.transition = 'background-color 0.3s ease';
    
    const colors = this.theme.getColors();
    
    // BACKGROUND - Utilise background.general
    if (colors?.background?.general) {
      this.container.style.backgroundColor = colors.background.general;
    }
    
    // TEXT - Utilise text.body pour le texte
    const textColor = colors?.text?.title || '#FFFFFF';
    
    // ICONS - Utilise icon.standard et icon.hover
    const iconBg = colors?.icon?.standard || 'rgba(255,255,255,0.2)';
    const iconHoverBg = colors?.icon?.hover || iconBg;
    
    const textContainer = document.createElement('div');
    textContainer.id = this.options.textContainerId;
    textContainer.style.cssText = `
      position: relative;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    this.container.appendChild(textContainer);
    this.textContainer = textContainer;
    
    // Flèche gauche
    const leftArrow = document.createElement('i');
    leftArrow.className = 'fas fa-arrow-left announcement-nav-arrow';
    leftArrow.style.cssText = `
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 16px;
      cursor: pointer;
      z-index: 10;
      opacity: 0.7;
      transition: all 0.3s ease;
      padding: 8px;
      background: ${iconBg};
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex !important;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    
    leftArrow.addEventListener('mouseenter', () => {
      leftArrow.style.opacity = '1';
      leftArrow.style.background = iconHoverBg;
      leftArrow.style.transform = 'translateY(-50%) scale(1.05)';
    });
    leftArrow.addEventListener('mouseleave', () => {
      leftArrow.style.opacity = '0.7';
      leftArrow.style.background = iconBg;
      leftArrow.style.transform = 'translateY(-50%) scale(1)';
    });
    leftArrow.addEventListener('click', () => this.previousAnnouncement());
    this.container.appendChild(leftArrow);
    
    // Flèche droite
    const rightArrow = document.createElement('i');
    rightArrow.className = 'fas fa-arrow-right announcement-nav-arrow';
    rightArrow.style.cssText = `
      position: absolute;
      right: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: white;
      font-size: 16px;
      cursor: pointer;
      z-index: 10;
      opacity: 0.7;
      transition: all 0.3s ease;
      padding: 8px;
      background: ${iconBg};
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex !important;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    
    rightArrow.addEventListener('mouseenter', () => {
      rightArrow.style.opacity = '1';
      rightArrow.style.background = iconHoverBg;
      rightArrow.style.transform = 'translateY(-50%) scale(1.05)';
    });
    rightArrow.addEventListener('mouseleave', () => {
      rightArrow.style.opacity = '0.7';
      rightArrow.style.background = iconBg;
      rightArrow.style.transform = 'translateY(-50%) scale(1)';
    });
    rightArrow.addEventListener('click', () => this.nextAnnouncement());
    this.container.appendChild(rightArrow);
  }
  
  init() {
    this.loadAnnouncements();
  }
  
  loadAnnouncements() {
    try {
      const announcementsRef = collection(db, 'announcementBar');
      const q = query(announcementsRef, where('isActive', '==', true), orderBy('order', 'asc'));
      
      onSnapshot(q, (snapshot) => {
        this.announcements = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.startRotation();
      }, (error) => {
        console.error("❌ AnnouncementBar: Erreur Firebase", error);
        this.showEmpty();
      });
    } catch (error) {
      console.error("❌ AnnouncementBar: Erreur critique", error);
    }
  }
  
  startRotation() {
    if (this.interval) clearInterval(this.interval);
    if (!this.textContainer) return;
    
    if (this.announcements.length === 0) {
      this.showEmpty();
      return;
    }
    
    this.updateAnnouncement(0);
    
    this.interval = setInterval(() => {
      this.currentIndex = (this.currentIndex + 1) % this.announcements.length;
      this.updateAnnouncement(this.currentIndex);
    }, 5000);
  }
  
  updateAnnouncement(index) {
    if (!this.textContainer || this.announcements.length === 0) return;
    
    const colors = this.theme.getColors();
    // TEXT - Utilise text.body pour le texte des annonces
    const textColor = colors?.text?.title || '#FFFFFF';
    // TYPOGRAPHY - Utilise typography.family pour la police
    const fontFamily = this.theme.getTypography().family || this.theme.getFonts().secondary || 'Manrope, sans-serif';
    
    this.textContainer.innerHTML = '';
    const textEl = document.createElement('span');
    textEl.className = 'announcement-text';
    textEl.style.cssText = `
      color: ${textColor};
      opacity: 0;
      transform: translateY(10px);
      transition: opacity 0.5s ease, transform 0.5s ease;
      font-family: ${fontFamily};
      font-size: 0.9rem;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-weight: 400;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 80%;
    `;
    textEl.textContent = this.announcements[index]?.text || '';
    this.textContainer.appendChild(textEl);
    
    setTimeout(() => {
      textEl.style.opacity = '1';
      textEl.style.transform = 'translateY(0)';
    }, 50);
  }
  
  previousAnnouncement() {
    if (this.announcements.length === 0) return;
    
    if (this.interval) {
      clearInterval(this.interval);
      this.startRotation();
    }
    
    this.currentIndex = (this.currentIndex - 1 + this.announcements.length) % this.announcements.length;
    this.updateAnnouncement(this.currentIndex);
    
    this.animateArrows();
  }
  
  nextAnnouncement() {
    if (this.announcements.length === 0) return;
    
    if (this.interval) {
      clearInterval(this.interval);
      this.startRotation();
    }
    
    this.currentIndex = (this.currentIndex + 1) % this.announcements.length;
    this.updateAnnouncement(this.currentIndex);
    
    this.animateArrows();
  }
  
  animateArrows() {
    const arrows = this.container.querySelectorAll('.announcement-nav-arrow');
    arrows.forEach(arrow => {
      arrow.style.transform = 'translateY(-50%) scale(0.9)';
      setTimeout(() => {
        arrow.style.transform = 'translateY(-50%) scale(1)';
      }, 150);
    });
  }
  
  showEmpty() {
    if (!this.textContainer) return;
    
    const colors = this.theme.getColors();
    const textColor = colors?.text?.title || '#FFFFFF';
    const fontFamily = this.theme.getTypography().family || this.theme.getFonts().secondary || 'Manrope, sans-serif';
    
    this.textContainer.innerHTML = '';
    const textEl = document.createElement('span');
    textEl.className = 'announcement-text';
    textEl.style.cssText = `
      color: ${textColor};
      opacity: 1;
      font-family: ${fontFamily};
      font-size: 0.9rem;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      font-weight: 400;
    `;
    textEl.textContent = '';
    this.textContainer.appendChild(textEl);
  }
  
  destroy() {
    if (this.interval) clearInterval(this.interval);
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.container) this.container.innerHTML = '';
  }
}

export default AnnouncementBar;