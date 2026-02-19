// ============= FOOTER COMPONENT - AFFICHAGE DU FOOTER =============
import { db } from './firebase-init.js';
import { 
  collection, query, getDocs, orderBy 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class FooterComponent {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Footer: Container #${containerId} non trouvé`);
      return;
    }
    
    this.options = {
      imageBasePath: './',
      showSocial: true,
      showContact: true,
      showInfos: true,
      showPayments: true,
      showCopyright: true,
      ...options
    };
    
    this.uniqueId = 'footer_' + Math.random().toString(36).substr(2, 9);
    this.config = null;
    this.socialNetworks = [];
    this.infoLinks = [];
    this.paymentMethods = [];
    
    this.init();
  }
  
  async init() {
    try {
      await this.loadData();
      this.render();
    } catch (error) {
      console.error('❌ Footer: Erreur init', error);
      this.renderError();
    }
  }
  
  async loadData() {
    try {
      // Charger la configuration générale
      const configSnapshot = await getDocs(collection(db, 'footerConfig'));
      if (!configSnapshot.empty) {
        this.config = configSnapshot.docs[0].data();
      } else {
        this.config = {
          logo: '',
          companyName: 'Vitch Studio',
          title: '',
          description: '',
          address: '',
          phone: '',
          email: '',
          copyright: {
            text: 'Tous droits réservés',
            year: 2026,
            custom: ''
          }
        };
      }
      
      // Charger les réseaux sociaux
      const socialSnapshot = await getDocs(query(
        collection(db, 'footerSocial'), 
        orderBy('createdAt', 'asc')
      ));
      this.socialNetworks = socialSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(s => s.active !== false);
      
      // Charger les liens d'information
      const infoSnapshot = await getDocs(query(
        collection(db, 'footerInfos'), 
        orderBy('createdAt', 'asc')
      ));
      this.infoLinks = infoSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(i => i.active !== false);
      
      // Charger les moyens de paiement
      const paymentSnapshot = await getDocs(query(
        collection(db, 'footerPayment'), 
        orderBy('createdAt', 'asc')
      ));
      this.paymentMethods = paymentSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(p => p.active !== false);
      
    } catch (error) {
      console.error('❌ Erreur chargement données footer:', error);
      throw error;
    }
  }
  
  getMediaPath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    return `${this.options.imageBasePath}${filename.split('/').pop()}`;
  }
  
  render() {
    const style = document.createElement('style');
    style.textContent = `
      .footer-${this.uniqueId} {
        --footer-bg: #1F1E1C;
        --footer-bg-soft: #2C2A29;
        --footer-text: #F5F1E8;
        --footer-text-muted: #B8B0A4;
        --footer-accent: #C6A75E;
        --footer-border: rgba(198, 167, 94, 0.2);
      }

      .footer-${this.uniqueId} {
        background: linear-gradient(180deg, var(--footer-bg) 0%, var(--footer-bg-soft) 100%);
        color: var(--footer-text);
        padding: 3rem 1.5rem 1.5rem;
        font-family: 'Manrope', sans-serif;
        width: 100%;
        border-top: 1px solid var(--footer-border);
      }
      
      .footer-container-${this.uniqueId} {
        max-width: 1280px;
        margin: 0 auto;
      }
      
      .footer-grid-${this.uniqueId} {
        display: grid;
        grid-template-columns: 1fr;
        gap: 2rem;
        margin-bottom: 2rem;
      }
      
      @media (min-width: 768px) {
        .footer-grid-${this.uniqueId} {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      
      @media (min-width: 1024px) {
        .footer-grid-${this.uniqueId} {
          grid-template-columns: repeat(4, 1fr);
        }
      }
      
      .footer-logo-${this.uniqueId} {
        font-family: 'Cormorant Garamond', serif;
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--footer-accent);
        margin-bottom: 0.5rem;
      }
      
      .footer-title-${this.uniqueId} {
        font-size: 0.9rem;
        color: var(--footer-text-muted);
        margin-bottom: 1rem;
      }
      
      .footer-description-${this.uniqueId} {
        font-size: 0.9rem;
        line-height: 1.6;
        color: rgba(245, 241, 232, 0.9);
        margin-bottom: 1.5rem;
      }
      
      .footer-social-${this.uniqueId} {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      
      .footer-social-link-${this.uniqueId} {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--footer-border);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--footer-text);
        transition: all 0.3s;
        text-decoration: none;
      }
      
      .footer-social-link-${this.uniqueId}:hover {
        background: var(--footer-accent);
        color: var(--footer-bg);
        transform: translateY(-2px);
      }
      
      .footer-social-link-${this.uniqueId} img {
        width: 18px;
        height: 18px;
        object-fit: contain;
        filter: brightness(0) invert(1);
      }
      
      .footer-social-link-${this.uniqueId}:hover img {
        filter: none;
      }
      
      .footer-heading-${this.uniqueId} {
        font-family: 'Cormorant Garamond', serif;
        font-size: 1.2rem;
        font-weight: 600;
        color: var(--footer-accent);
        margin-bottom: 1.2rem;
      }
      
      .footer-contact-item-${this.uniqueId} {
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 1rem;
        font-size: 0.9rem;
        color: rgba(245, 241, 232, 0.9);
        line-height: 1.5;
      }
      
      .footer-contact-item-${this.uniqueId} i {
        color: var(--footer-accent);
        width: 18px;
        margin-top: 0.2rem;
      }
      
      .footer-links-${this.uniqueId} {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      
      .footer-links-${this.uniqueId} li {
        margin-bottom: 0.75rem;
      }
      
      .footer-links-${this.uniqueId} a {
        color: rgba(245, 241, 232, 0.9);
        text-decoration: none;
        font-size: 0.9rem;
        transition: color 0.3s;
      }
      
      .footer-links-${this.uniqueId} a:hover {
        color: var(--footer-accent);
      }
      
      .footer-payments-${this.uniqueId} {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
      }
      
      .footer-payment-item-${this.uniqueId} {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid var(--footer-border);
        border-radius: 0.5rem;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s;
      }
      
      .footer-payment-item-${this.uniqueId}:hover {
        background: rgba(198, 167, 94, 0.22);
        transform: translateY(-2px);
      }
      
      .footer-payment-item-${this.uniqueId} img {
        height: 24px;
        width: auto;
        object-fit: contain;
      }
      
      .footer-payment-item-${this.uniqueId} i {
        font-size: 1.5rem;
        color: rgba(245, 241, 232, 0.9);
      }
      
      .footer-copyright-${this.uniqueId} {
        border-top: 1px solid var(--footer-border);
        padding-top: 1.5rem;
        margin-top: 1rem;
        text-align: center;
        font-size: 0.85rem;
        color: var(--footer-text-muted);
      }
      
      .footer-error-${this.uniqueId} {
        text-align: center;
        padding: 2rem;
        color: #7F1D1D;
        background: rgba(127, 29, 29, 0.1);
        border-radius: 0.5rem;
      }
      
      .footer-logo-img-${this.uniqueId} {
        max-height: 50px;
        width: auto;
        margin-bottom: 1rem;
      }
      
      .footer-logo-placeholder-${this.uniqueId} {
        width: 50px;
        height: 50px;
        background: var(--footer-accent);
        border-radius: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Cormorant Garamond', serif;
        font-size: 1.8rem;
        font-weight: 700;
        color: var(--footer-bg);
        margin-bottom: 1rem;
      }
      
      @media (max-width: 640px) {
        .footer-${this.uniqueId} {
          padding: 2rem 1rem 1rem;
        }
        
        .footer-social-${this.uniqueId} {
          justify-content: center;
        }
        
        .footer-contact-item-${this.uniqueId} {
          justify-content: center;
        }
      }
    `;
    
    document.head.appendChild(style);
    
    const year = this.config?.copyright?.year || 2026;
    const copyrightText = this.config?.copyright?.custom || 
      `© ${year} ${this.config?.companyName || 'Vitch Studio'}. ${this.config?.copyright?.text || 'Tous droits réservés'}`;
    
    const html = `
      <footer class="footer-${this.uniqueId}">
        <div class="footer-container-${this.uniqueId}">
          <div class="footer-grid-${this.uniqueId}">
            <!-- Colonne 1: Logo et description -->
            <div class="footer-col-${this.uniqueId}">
              ${this.renderLogo()}
              
              ${this.config?.title ? `
                <div class="footer-title-${this.uniqueId}">${this.config.title}</div>
              ` : ''}
              
              ${this.config?.description ? `
                <p class="footer-description-${this.uniqueId}">${this.config.description}</p>
              ` : ''}
              
              ${this.options.showSocial && this.socialNetworks.length > 0 ? `
                <div class="footer-social-${this.uniqueId}">
                  ${this.renderSocialNetworks()}
                </div>
              ` : ''}
            </div>
            
            <!-- Colonne 2: Coordonnées -->
            ${this.options.showContact ? `
              <div class="footer-col-${this.uniqueId}">
                <h3 class="footer-heading-${this.uniqueId}">Contact</h3>
                ${this.renderContact()}
              </div>
            ` : ''}
            
            <!-- Colonne 3: Liens informations -->
            ${this.options.showInfos && this.infoLinks.length > 0 ? `
              <div class="footer-col-${this.uniqueId}">
                <h3 class="footer-heading-${this.uniqueId}">Informations</h3>
                <ul class="footer-links-${this.uniqueId}">
                  ${this.renderInfoLinks()}
                </ul>
              </div>
            ` : ''}
            
            <!-- Colonne 4: Moyens de paiement -->
            ${this.options.showPayments && this.paymentMethods.length > 0 ? `
              <div class="footer-col-${this.uniqueId}">
                <h3 class="footer-heading-${this.uniqueId}">Paiements acceptés</h3>
                <div class="footer-payments-${this.uniqueId}">
                  ${this.renderPaymentMethods()}
                </div>
              </div>
            ` : ''}
          </div>
          
          <!-- Copyright -->
          ${this.options.showCopyright ? `
            <div class="footer-copyright-${this.uniqueId}">
              ${copyrightText}
            </div>
          ` : ''}
        </div>
      </footer>
    `;
    
    this.container.innerHTML = html;
  }
  
  renderLogo() {
    const logoPath = this.getMediaPath(this.config?.logo || '');
    
    if (logoPath) {
      return `<img src="${logoPath}" alt="${this.config?.companyName || 'Logo'}" class="footer-logo-img-${this.uniqueId}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`;
    }
    
    return `
      <div class="footer-logo-placeholder-${this.uniqueId}">
        ${(this.config?.companyName || 'V')[0].toUpperCase()}
      </div>
    `;
  }
  
  renderSocialNetworks() {
    return this.socialNetworks.map(social => {
      const icon = social.image ? 
        `<img src="${this.getMediaPath(social.image)}" alt="${social.networkName || social.network}">` : 
        `<i class="${social.icon || 'fab fa-' + social.network}"></i>`;
      
      return `
        <a href="${social.link}" 
           class="footer-social-link-${this.uniqueId}" 
           target="_blank" 
           rel="noopener noreferrer"
           title="${social.networkName || social.network}">
          ${icon}
        </a>
      `;
    }).join('');
  }
  
  renderContact() {
    const items = [];
    
    if (this.config?.address) {
      items.push(`
        <div class="footer-contact-item-${this.uniqueId}">
          <i class="fas fa-map-marker-alt"></i>
          <span>${this.config.address}</span>
        </div>
      `);
    }
    
    if (this.config?.phone) {
      items.push(`
        <div class="footer-contact-item-${this.uniqueId}">
          <i class="fas fa-phone"></i>
          <a href="tel:${this.config.phone.replace(/\s/g, '')}" style="color: inherit; text-decoration: none;">
            ${this.config.phone}
          </a>
        </div>
      `);
    }
    
    if (this.config?.email) {
      items.push(`
        <div class="footer-contact-item-${this.uniqueId}">
          <i class="fas fa-envelope"></i>
          <a href="mailto:${this.config.email}" style="color: inherit; text-decoration: none;">
            ${this.config.email}
          </a>
        </div>
      `);
    }
    
    if (items.length === 0) {
      return '<p class="footer-description-${this.uniqueId}">Aucune coordonnée</p>';
    }
    
    return items.join('');
  }
  
  renderInfoLinks() {
    return this.infoLinks.map(link => `
      <li>
        <a href="${link.link}" target="_blank" rel="noopener noreferrer">
          ${link.title}
        </a>
      </li>
    `).join('');
  }
  
  renderPaymentMethods() {
    return this.paymentMethods.map(payment => {
      if (payment.image) {
        return `
          <div class="footer-payment-item-${this.uniqueId}" title="${payment.name || payment.type}">
            <img src="${this.getMediaPath(payment.image)}" alt="${payment.name || payment.type}">
          </div>
        `;
      } else {
        return `
          <div class="footer-payment-item-${this.uniqueId}" title="${payment.name || payment.type}">
            <i class="fab fa-cc-${payment.type}"></i>
          </div>
        `;
      }
    }).join('');
  }
  
  renderError() {
    this.container.innerHTML = `
      <div class="footer-error-${this.uniqueId}">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 1rem;"></i>
        <p>Erreur de chargement du footer</p>
      </div>
    `;
  }
  
  // Méthode publique pour recharger
  async reload() {
    await this.loadData();
    this.render();
  }
}

export default FooterComponent;
