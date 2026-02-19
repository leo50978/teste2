// ============= CHECKOUT COMPONENT - MODAL DE PAIEMENT =============
import { db } from './firebase-init.js';
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CheckoutModal {
  constructor(options = {}) {
    this.options = {
      onClose: null,
      onSuccess: null,
      currency: 'HTG',
      imageBasePath: './',
      shippingCost: 5.90,
      freeShippingThreshold: 50,
      cart: [],
      client: null,
      ...options
    };
    
    this.cart = this.options.cart || [];
    this.client = this.options.client;
    this.subtotal = 0;
    this.shipping = 0;
    this.total = 0;
    this.uniqueId = 'checkout_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.paymentModal = null;
    this.deliverySettings = null;
    this.deliveryData = {
      homeZones: [],
      pickupPoints: [],
      meetupZones: [],
      weightRules: []
    };
    this.selectedDelivery = {
      method: null,
      home: {
        zoneId: '',
        address: '',
        phone: '',
        whatsapp: ''
      },
      pickup: {
        pointId: ''
      },
      meetup: {
        zoneId: '',
        proposal: '',
        phone: '',
        whatsapp: ''
      }
    };
    this.deliveryFees = {
      base: 0,
      weightExtra: 0,
      total: 0
    };
    
    if (!this.client) {
      console.error('❌ Checkout: Aucun client fourni');
    }
    
    this.calculateTotals();
    this.render();
    this.attachEvents();
    this.animateIn();
    this.initDelivery();
    
    // Bloquer le scroll du body
    document.body.style.overflow = 'hidden';
  }
  
  calculateTotals() {
    this.subtotal = this.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    this.shipping = Number(this.shipping) || 0;
    this.total = this.subtotal + this.shipping;
  }
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    const cleanName = filename.split('/').pop();
    return `${this.options.imageBasePath}${cleanName}`;
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency', 
      currency: this.options.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price || 0);
  }
  
  render() {
    this.modal = document.createElement('div');
    this.modal.className = `checkout-modal-${this.uniqueId}`;
    this.modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    
    this.modal.innerHTML = `
      <div class="checkout-container-${this.uniqueId}" style="
        background: #F5F1E8;
        border-radius: 1.5rem;
        width: 100%;
        max-width: 900px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        transform: scale(0.95);
        transition: transform 0.3s ease;
        position: relative;
      ">
        <!-- Header avec bouton fermeture -->
        <div style="
          position: sticky;
          top: 0;
          background: #F5F1E8;
          border-bottom: 1px solid rgba(198, 167, 94, 0.2);
          padding: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
          border-radius: 1.5rem 1.5rem 0 0;
        ">
          <h2 style="
            font-family: 'Cormorant Garamond', serif;
            font-size: 1.8rem;
            color: #1F1E1C;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-lock" style="color: #C6A75E; font-size: 1.2rem;"></i>
            Paiement sécurisé
          </h2>
          <button class="close-checkout" style="
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #8B7E6B;
            transition: all 0.2s;
            padding: 0.5rem;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          " onmouseover="this.style.background='rgba(198,167,94,0.1)'; this.style.color='#C6A75E'" onmouseout="this.style.background='transparent'; this.style.color='#8B7E6B'">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <!-- Informations client -->
        <div style="padding: 1rem 1.5rem; background: #C6A75E10; border-bottom: 1px solid rgba(198, 167, 94, 0.2);">
          <div style="display: flex; align-items: center; gap: 0.5rem; color: #1F1E1C;">
            <i class="fas fa-user-circle"></i>
            <span style="font-weight: 500;">${this.client?.name || 'Client'}</span>
            <span style="color: #8B7E6B;">(${this.client?.email || 'Email non renseigné'})</span>
          </div>
        </div>
        
        <!-- Contenu principal -->
        <div style="padding: 1.5rem;">
          ${this.cart.length === 0 ? this.renderEmptyCart() : this.renderCheckoutContent()}
        </div>
      </div>
      
      <style>
        @keyframes checkoutSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .checkout-container-${this.uniqueId} {
          animation: checkoutSlideIn 0.3s ease forwards;
        }
        
        /* Scrollbar personnalisée */
        .checkout-container-${this.uniqueId}::-webkit-scrollbar {
          width: 6px;
        }
        
        .checkout-container-${this.uniqueId}::-webkit-scrollbar-track {
          background: rgba(198, 167, 94, 0.1);
          border-radius: 3px;
        }
        
        .checkout-container-${this.uniqueId}::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 3px;
        }
        
        /* Styles pour le tableau responsive */
        .checkout-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .checkout-table th {
          text-align: left;
          padding: 0.75rem;
          font-weight: 500;
          color: #8B7E6B;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 2px solid rgba(198, 167, 94, 0.2);
        }
        
        .checkout-table td {
          padding: 1rem 0.75rem;
          border-bottom: 1px solid rgba(198, 167, 94, 0.1);
          vertical-align: top;
        }
        
        .checkout-table tr:last-child td {
          border-bottom: none;
        }
        
        /* Version mobile : carte produit */
        @media (max-width: 640px) {
          .checkout-table thead {
            display: none;
          }
          
          .checkout-table tr {
            display: block;
            margin-bottom: 1.5rem;
            border: 1px solid rgba(198, 167, 94, 0.2);
            border-radius: 0.75rem;
            padding: 1rem;
          }
          
          .checkout-table td {
            display: block;
            padding: 0.5rem 0;
            border-bottom: none;
          }
          
          .checkout-table td::before {
            content: attr(data-label);
            display: inline-block;
            width: 100px;
            font-weight: 500;
            color: #8B7E6B;
            font-size: 0.85rem;
          }
          
          .mobile-product-row {
            display: flex;
            gap: 1rem;
            align-items: start;
          }
        }
      </style>
    `;
    
    document.body.appendChild(this.modal);
  }
  
  renderEmptyCart() {
    return `
      <div style="
        text-align: center;
        padding: 3rem 1rem;
      ">
        <div style="
          width: 120px;
          height: 120px;
          background: rgba(198, 167, 94, 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        ">
          <i class="fas fa-shopping-bag" style="font-size: 3rem; color: #C6A75E; opacity: 0.5;"></i>
        </div>
        <h3 style="
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.5rem;
          color: #1F1E1C;
          margin-bottom: 0.5rem;
        ">Votre panier est vide</h3>
        <p style="color: #8B7E6B; margin-bottom: 2rem;">
          Ajoutez des produits pour procéder au paiement
        </p>
        <button class="close-checkout" style="
          background: #1F1E1C;
          color: #F5F1E8;
          border: 1px solid #C6A75E;
          padding: 0.75rem 2rem;
          border-radius: 0.5rem;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.3s;
        " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
          Retour aux achats
        </button>
      </div>
    `;
  }
  
  renderCheckoutContent() {
    const baseFee = Number(this.deliveryFees.base || 0);
    const weightFee = Number(this.deliveryFees.weightExtra || 0);
    const baseDisplay = baseFee === 0 && weightFee === 0 ? 'Gratuite' : this.formatPrice(baseFee);
    return `
      <!-- Version Desktop (tableau) -->
      <div class="hidden sm:block">
        <table class="checkout-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Options</th>
              <th>Prix unit.</th>
              <th>Quantité</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${this.cart.map((item, index) => this.renderDesktopRow(item, index)).join('')}
          </tbody>
        </table>
      </div>
      
      <!-- Version Mobile (cartes) -->
      <div class="sm:hidden space-y-4">
        ${this.cart.map((item, index) => this.renderMobileCard(item, index)).join('')}
      </div>
      
      <!-- Livraison -->
      ${this.renderDeliverySection()}
      
      <!-- Résumé et paiement -->
      <div style="
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 2px solid rgba(198, 167, 94, 0.2);
      ">
        <!-- Code promo (optionnel) -->
        <div style="
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        ">
          <input type="text" class="promo-code" placeholder="Code promo" style="
            flex: 1;
            padding: 0.75rem;
            border: 1px solid rgba(198, 167, 94, 0.3);
            border-radius: 0.5rem;
            background: white;
            font-size: 0.95rem;
          ">
          <button class="apply-promo" style="
            background: transparent;
            color: #1F1E1C;
            border: 1px solid #C6A75E;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: 500;
          " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='transparent'; this.style.color='#1F1E1C'">
            Appliquer
          </button>
        </div>
        
        <!-- Totaux -->
        <div style="
          max-width: 400px;
          margin-left: auto;
        ">
          <div style="
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 1rem;
          ">
            <span style="color: #8B7E6B;">Sous-total</span>
            <span style="font-weight: 500;">${this.formatPrice(this.subtotal)}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 1rem;
          ">
            <span style="color: #8B7E6B; display: flex; align-items: center; gap: 0.25rem;">
              <i class="fas fa-truck"></i>
              Livraison
            </span>
            <span data-shipping-amount style="font-weight: 500;">
              ${baseDisplay}
            </span>
          </div>
          
          <div data-weight-row style="
            display: ${weightFee > 0 ? 'flex' : 'none'};
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 0.95rem;
          ">
            <span style="color: #8B7E6B;">Supplément poids</span>
            <span data-weight-fee style="font-weight: 500;">${weightFee > 0 ? this.formatPrice(weightFee) : this.formatPrice(0)}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 2px solid #C6A75E;
            font-size: 1.25rem;
            font-weight: bold;
          ">
            <span>Total TTC</span>
            <span data-total-amount style="color: #1F1E1C;">${this.formatPrice(this.total)}</span>
          </div>
        </div>
        
        <!-- Bouton paiement -->
        <button class="pay-now-btn" style="
          width: 100%;
          background: #1F1E1C;
          color: #F5F1E8;
          border: 2px solid #C6A75E;
          padding: 1.25rem;
          border-radius: 0.75rem;
          font-size: 1.2rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
          <i class="fas fa-lock"></i>
          Payer ${this.formatPrice(this.total)}
        </button>
      </div>
    `;
  }

  renderDeliverySection() {
    const methods = this.getAvailableDeliveryMethods();
    const methodOptions = methods.length > 0
      ? methods.map(m => this.renderDeliveryMethodRadio(m)).join('')
      : `<div style="color:#8B7E6B;font-size:0.9rem;">Aucune méthode de livraison disponible pour le moment.</div>`;
    
    return `
      <div class="delivery-section-${this.uniqueId}" style="
        margin-top: 1.5rem;
        padding: 1.25rem;
        background: rgba(198, 167, 94, 0.08);
        border: 1px solid rgba(198, 167, 94, 0.2);
        border-radius: 1rem;
      ">
        <h3 style="
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.35rem;
          margin-bottom: 0.75rem;
          color: #1F1E1C;
        ">
          Choisir une méthode de livraison
        </h3>
        <div class="delivery-methods" style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
          ${methodOptions}
        </div>
        
        <div class="delivery-panels">
          <div class="delivery-panel" data-delivery-panel="home" style="display:none;">
            <div style="display:grid;gap:0.75rem;">
              <label style="font-size:0.9rem;color:#8B7E6B;">Ville / Zone</label>
              <select class="delivery-home-zone" style="
                padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
              ">
                ${this.renderSelectOptions(this.deliveryData.homeZones, 'Aucune zone disponible')}
              </select>
              
              <label style="font-size:0.9rem;color:#8B7E6B;">Adresse</label>
              <input type="text" class="delivery-home-address" placeholder="Adresse complète" style="
                padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
              ">
              
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">Téléphone</label>
                  <input type="text" class="delivery-home-phone" placeholder="Ex: 37 00 00 00" style="
                    width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                  ">
                </div>
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">WhatsApp</label>
                  <input type="text" class="delivery-home-whatsapp" placeholder="Ex: 37 00 00 00" style="
                    width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                  ">
                </div>
              </div>
            </div>
          </div>
          
          <div class="delivery-panel" data-delivery-panel="pickup" style="display:none;">
            <label style="font-size:0.9rem;color:#8B7E6B;">Point de retrait</label>
            <select class="delivery-pickup-point" style="
              width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
            ">
              ${this.renderSelectOptions(this.deliveryData.pickupPoints, 'Aucun point disponible')}
            </select>
            <div class="pickup-details" style="margin-top:0.75rem;font-size:0.9rem;color:#8B7E6B;"></div>
          </div>
          
          <div class="delivery-panel" data-delivery-panel="meetup" style="display:none;">
            <label style="font-size:0.9rem;color:#8B7E6B;">Zone de rencontre</label>
            <select class="delivery-meetup-zone" style="
              width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
            ">
              ${this.renderSelectOptions(this.deliveryData.meetupZones, 'Aucune zone disponible')}
            </select>
            
            <div class="meetup-proposal-wrapper" style="margin-top:0.75rem;display:none;">
              <label style="font-size:0.9rem;color:#8B7E6B;">Proposer un lieu</label>
              <input type="text" class="delivery-meetup-proposal" placeholder="Proposez un point de rencontre" style="
                width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
              ">
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:0.75rem;">
              <div>
                <label style="font-size:0.9rem;color:#8B7E6B;">Téléphone</label>
                <input type="text" class="delivery-meetup-phone" placeholder="Ex: 37 00 00 00" style="
                  width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                ">
              </div>
              <div>
                <label style="font-size:0.9rem;color:#8B7E6B;">WhatsApp</label>
                <input type="text" class="delivery-meetup-whatsapp" placeholder="Ex: 37 00 00 00" style="
                  width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                ">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getAvailableDeliveryMethods() {
    const defaults = { home: true, pickup: true, meetup: true };
    const settings = this.deliverySettings?.methodsVisible || defaults;
    const methods = [];
    if (settings.home) methods.push({ key: 'home', label: 'A domicile', icon: 'fa-house' });
    if (settings.pickup) methods.push({ key: 'pickup', label: 'Retrait en point de vente', icon: 'fa-store' });
    if (settings.meetup) methods.push({ key: 'meetup', label: 'Par rencontre', icon: 'fa-people-arrows' });
    return methods;
  }

  renderDeliveryMethodRadio(method) {
    const id = `${this.uniqueId}_delivery_${method.key}`;
    return `
      <label for="${id}" style="
        display:flex;align-items:center;gap:0.5rem;
        padding:0.6rem 0.9rem;border:1px solid rgba(198,167,94,0.3);
        border-radius:999px;background:white;cursor:pointer;font-size:0.9rem;color:#1F1E1C;
      ">
        <input type="radio" id="${id}" name="delivery_method_${this.uniqueId}" value="${method.key}" style="accent-color:#C6A75E;">
        <i class="fas ${method.icon}" style="color:#C6A75E;"></i>
        ${method.label}
      </label>
    `;
  }

  renderSelectOptions(items, emptyLabel) {
    if (!items || items.length === 0) {
      return `<option value="">${emptyLabel}</option>`;
    }
    const options = items.map(item => {
      const label = item.displayLabel || item.label || item.name || item.zone || item.city || 'Option';
      const fee = Number(item.fee || 0);
      const feeText = fee > 0 ? ` • ${this.formatPrice(fee)}` : '';
      return `<option value="${item.id}">${label}${feeText}</option>`;
    });
    return `<option value="">Sélectionner...</option>${options.join('')}`;
  }
  
  renderDesktopRow(item, index) {
    const options = item.selectedOptions || [];
    const imagePath = this.getImagePath(item.image || '');
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    
    return `
      <tr data-index="${index}">
        <td style="min-width: 200px;">
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div style="
              width: 60px;
              height: 60px;
              background: #F5F1E8;
              border-radius: 0.5rem;
              overflow: hidden;
              border: 1px solid rgba(198, 167, 94, 0.2);
            ">
              <img src="${imagePath}" alt="${item.name}" style="
                width: 100%;
                height: 100%;
                object-fit: cover;
              " onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\'><i class=\'fas fa-image\'></i></div>'">
            </div>
            <div>
              <div style="font-weight: 500;">${item.name || 'Produit'}</div>
              ${item.sku ? `<div style="font-size: 0.7rem; color: #8B7E6B;">SKU: ${item.sku}</div>` : ''}
            </div>
          </div>
        </td>
        
        <td>
          ${options.length > 0 ? options.map(opt => `
            <div style="
              display: inline-flex;
              align-items: center;
              gap: 0.25rem;
              background: rgba(198, 167, 94, 0.1);
              padding: 0.2rem 0.5rem;
              border-radius: 2rem;
              font-size: 0.8rem;
              margin-right: 0.25rem;
              margin-bottom: 0.25rem;
            ">
              ${opt.image ? `
                <img src="${this.getImagePath(opt.image)}" 
                     style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover;"
                     onerror="this.style.display='none'">
              ` : ''}
              <span>${opt.value}</span>
            </div>
          `).join('') : '-'}
        </td>
        
        <td>${this.formatPrice(item.price || 0)}</td>
        
        <td>
          <span style="min-width: 30px; text-align: center;">${item.quantity}</span>
        </td>
        
        <td style="font-weight: 600;">${this.formatPrice(itemTotal)}</td>
      </tr>
    `;
  }
  
  renderMobileCard(item, index) {
    const options = item.selectedOptions || [];
    const imagePath = this.getImagePath(item.image || '');
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    
    return `
      <div class="checkout-mobile-item" data-index="${index}" style="
        background: white;
        border-radius: 1rem;
        padding: 1rem;
        border: 1px solid rgba(198, 167, 94, 0.2);
      ">
        <div class="mobile-product-row">
          <div style="
            width: 80px;
            height: 80px;
            background: #F5F1E8;
            border-radius: 0.5rem;
            overflow: hidden;
            border: 1px solid rgba(198, 167, 94, 0.2);
          ">
            <img src="${imagePath}" alt="${item.name}" style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            " onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\'><i class=\'fas fa-image\'></i></div>'">
          </div>
          
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div>
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${item.name || 'Produit'}</div>
                ${item.sku ? `<div style="font-size: 0.7rem; color: #8B7E6B;">SKU: ${item.sku}</div>` : ''}
              </div>
            </div>
            
            ${options.length > 0 ? `
              <div style="
                display: flex;
                flex-wrap: wrap;
                gap: 0.25rem;
                margin: 0.5rem 0;
              ">
                ${options.map(opt => `
                  <span style="
                    display: inline-flex;
                    align-items: center;
                    gap: 0.25rem;
                    background: rgba(198, 167, 94, 0.1);
                    padding: 0.2rem 0.5rem;
                    border-radius: 2rem;
                    font-size: 0.75rem;
                  ">
                    ${opt.image ? `
                      <img src="${this.getImagePath(opt.image)}" 
                           style="width: 14px; height: 14px; border-radius: 50%; object-fit: cover;"
                           onerror="this.style.display='none'">
                    ` : ''}
                    <span>${opt.value}</span>
                  </span>
                `).join('')}
              </div>
            ` : ''}
            
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-top: 0.5rem;
            ">
              <div style="font-weight: bold;">${this.formatPrice(itemTotal)}</div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 0.9rem;">x${item.quantity}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async initDelivery() {
    try {
      await this.loadDeliverySettings();
      await this.loadDeliveryData();
      this.refreshDeliverySection();
      this.setDefaultDeliveryMethod();
      this.updateDeliveryCosts();
      this.updateTotalsUI();
    } catch (error) {
      console.error('❌ Erreur chargement livraison:', error);
    }
  }

  async loadDeliverySettings() {
    try {
      const settingsRef = doc(db, 'deliverySettings', 'main');
      const snapshot = await getDoc(settingsRef);
      if (snapshot.exists()) {
        this.deliverySettings = snapshot.data();
      } else {
        this.deliverySettings = {
          methodsVisible: { home: true, pickup: true, meetup: true },
          allowMeetupProposal: true
        };
      }
    } catch (error) {
      console.error('❌ Erreur paramètres livraison:', error);
      this.deliverySettings = {
        methodsVisible: { home: true, pickup: true, meetup: true },
        allowMeetupProposal: true
      };
    }
  }

  async loadDeliveryData() {
    const loadCollection = async (name) => {
      try {
        const snapshot = await getDocs(collection(db, name));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (error) {
        console.error(`❌ Erreur chargement ${name}:`, error);
        return [];
      }
    };
    
    const [homeZones, pickupPoints, meetupZones, weightRules] = await Promise.all([
      loadCollection('deliveryHomeZones'),
      loadCollection('deliveryPickupPoints'),
      loadCollection('deliveryMeetupZones'),
      loadCollection('deliveryWeightRules')
    ]);
    
    this.deliveryData.homeZones = homeZones
      .filter(zone => zone.isActive !== false)
      .map(zone => ({
        ...zone,
        displayLabel: zone.zone ? `${zone.city} - ${zone.zone}` : zone.city || zone.name
      }));
    this.deliveryData.pickupPoints = pickupPoints
      .filter(point => point.isActive !== false)
      .map(point => ({
        ...point,
        displayLabel: point.name || point.title || 'Point de retrait'
      }));
    this.deliveryData.meetupZones = meetupZones
      .filter(zone => zone.isActive !== false)
      .map(zone => ({
        ...zone,
        displayLabel: zone.zone || zone.name || 'Zone de rencontre'
      }));
    this.deliveryData.weightRules = weightRules
      .filter(rule => rule.isActive !== false)
      .map(rule => ({
        ...rule,
        minGrams: Number(rule.minGrams || 0),
        maxGrams: Number(rule.maxGrams || 0),
        fee: Number(rule.fee || 0)
      }))
      .sort((a, b) => a.minGrams - b.minGrams);
  }

  refreshDeliverySection() {
    const section = this.modal.querySelector('.delivery-section-' + this.uniqueId);
    if (!section) return;
    section.outerHTML = this.renderDeliverySection();
    this.bindDeliveryEvents();
    this.updateDeliveryPanels();
    this.updatePickupDetails();
    this.updateMeetupProposalVisibility();
  }

  setDefaultDeliveryMethod() {
    const methods = this.getAvailableDeliveryMethods();
    if (!methods.length) {
      this.selectedDelivery.method = null;
      return;
    }
    if (this.selectedDelivery.method && methods.find(m => m.key === this.selectedDelivery.method)) {
      return;
    }
    this.selectedDelivery.method = methods[0].key;
    const defaultRadio = this.modal.querySelector(`input[name="delivery_method_${this.uniqueId}"][value="${this.selectedDelivery.method}"]`);
    if (defaultRadio) {
      defaultRadio.checked = true;
    }
    this.updateDeliveryPanels();
  }

  bindDeliveryEvents() {
    const methodRadios = this.modal.querySelectorAll(`input[name="delivery_method_${this.uniqueId}"]`);
    methodRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        this.selectedDelivery.method = radio.value;
        this.updateDeliveryPanels();
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    });
    
    const homeSelect = this.modal.querySelector('.delivery-home-zone');
    if (homeSelect) {
      homeSelect.addEventListener('change', () => {
        this.selectedDelivery.home.zoneId = homeSelect.value;
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }
    
    const pickupSelect = this.modal.querySelector('.delivery-pickup-point');
    if (pickupSelect) {
      pickupSelect.addEventListener('change', () => {
        this.selectedDelivery.pickup.pointId = pickupSelect.value;
        this.updatePickupDetails();
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }
    
    const meetupSelect = this.modal.querySelector('.delivery-meetup-zone');
    if (meetupSelect) {
      meetupSelect.addEventListener('change', () => {
        this.selectedDelivery.meetup.zoneId = meetupSelect.value;
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }
    
    const addressInput = this.modal.querySelector('.delivery-home-address');
    if (addressInput) {
      addressInput.addEventListener('input', () => {
        this.selectedDelivery.home.address = addressInput.value;
      });
    }
    
    const homePhone = this.modal.querySelector('.delivery-home-phone');
    if (homePhone) {
      homePhone.addEventListener('input', () => {
        this.selectedDelivery.home.phone = homePhone.value;
      });
    }
    
    const homeWhatsapp = this.modal.querySelector('.delivery-home-whatsapp');
    if (homeWhatsapp) {
      homeWhatsapp.addEventListener('input', () => {
        this.selectedDelivery.home.whatsapp = homeWhatsapp.value;
      });
    }
    
    const meetupPhone = this.modal.querySelector('.delivery-meetup-phone');
    if (meetupPhone) {
      meetupPhone.addEventListener('input', () => {
        this.selectedDelivery.meetup.phone = meetupPhone.value;
      });
    }
    
    const meetupWhatsapp = this.modal.querySelector('.delivery-meetup-whatsapp');
    if (meetupWhatsapp) {
      meetupWhatsapp.addEventListener('input', () => {
        this.selectedDelivery.meetup.whatsapp = meetupWhatsapp.value;
      });
    }
    
    const meetupProposal = this.modal.querySelector('.delivery-meetup-proposal');
    if (meetupProposal) {
      meetupProposal.addEventListener('input', () => {
        this.selectedDelivery.meetup.proposal = meetupProposal.value;
      });
    }
  }

  updateDeliveryPanels() {
    const panels = this.modal.querySelectorAll('.delivery-panel');
    panels.forEach(panel => {
      const panelType = panel.getAttribute('data-delivery-panel');
      panel.style.display = panelType === this.selectedDelivery.method ? 'block' : 'none';
    });
    this.updateMeetupProposalVisibility();
  }

  updatePickupDetails() {
    const details = this.modal.querySelector('.pickup-details');
    if (!details) return;
    const point = this.deliveryData.pickupPoints.find(p => p.id === this.selectedDelivery.pickup.pointId);
    if (!point) {
      details.textContent = '';
      return;
    }
    const phone = point.phone ? ` • Tél: ${point.phone}` : '';
    const whatsapp = point.whatsapp ? ` • WhatsApp: ${point.whatsapp}` : '';
    details.textContent = `${point.address || ''}${phone}${whatsapp}`;
  }

  updateMeetupProposalVisibility() {
    const wrapper = this.modal.querySelector('.meetup-proposal-wrapper');
    if (!wrapper) return;
    wrapper.style.display = this.deliverySettings?.allowMeetupProposal ? 'block' : 'none';
  }

  updateDeliveryCosts() {
    let baseFee = 0;
    if (this.selectedDelivery.method === 'home') {
      const zone = this.deliveryData.homeZones.find(z => z.id === this.selectedDelivery.home.zoneId);
      baseFee = Number(zone?.fee || 0);
    } else if (this.selectedDelivery.method === 'pickup') {
      baseFee = 0;
    } else if (this.selectedDelivery.method === 'meetup') {
      const zone = this.deliveryData.meetupZones.find(z => z.id === this.selectedDelivery.meetup.zoneId);
      baseFee = Number(zone?.fee || 0);
    }
    
    const weightGrams = this.getCartWeight();
    const weightFee = this.getWeightFee(weightGrams);
    
    this.deliveryFees = {
      base: baseFee,
      weightExtra: weightFee,
      total: baseFee + weightFee
    };
    this.shipping = this.deliveryFees.total;
    this.calculateTotals();
  }

  getCartWeight() {
    return this.cart.reduce((sum, item) => {
      const weight = Number(item?.weightGrams || item?.weight || 0);
      return sum + (weight * (item.quantity || 1));
    }, 0);
  }

  getWeightFee(weightGrams) {
    if (!this.deliveryData.weightRules || this.deliveryData.weightRules.length === 0) return 0;
    const rule = this.deliveryData.weightRules.find(r => weightGrams >= r.minGrams && weightGrams <= r.maxGrams);
    return Number(rule?.fee || 0);
  }

  updateTotalsUI() {
    const shippingEl = this.modal.querySelector('[data-shipping-amount]');
    if (shippingEl) {
      const baseFee = Number(this.deliveryFees.base || 0);
      const weightFee = Number(this.deliveryFees.weightExtra || 0);
      shippingEl.textContent = baseFee === 0 && weightFee === 0 ? 'Gratuite' : this.formatPrice(baseFee);
    }
    const weightRow = this.modal.querySelector('[data-weight-row]');
    const weightFeeEl = this.modal.querySelector('[data-weight-fee]');
    if (weightRow && weightFeeEl) {
      if (this.deliveryFees.weightExtra > 0) {
        weightRow.style.display = 'flex';
        weightFeeEl.textContent = this.formatPrice(this.deliveryFees.weightExtra);
      } else {
        weightRow.style.display = 'none';
      }
    }
    const totalEl = this.modal.querySelector('[data-total-amount]');
    if (totalEl) {
      totalEl.textContent = this.formatPrice(this.total);
    }
  }

  isValidPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }

  validateDelivery() {
    if (!this.selectedDelivery.method) {
      this.showMessage('Veuillez choisir une méthode de livraison', 'error');
      return false;
    }
    
    if (this.selectedDelivery.method === 'home') {
      if (!this.selectedDelivery.home.zoneId) {
        this.showMessage('Veuillez sélectionner une ville ou zone', 'error');
        return false;
      }
      if (!this.selectedDelivery.home.address?.trim()) {
        this.showMessage('Veuillez saisir votre adresse', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.home.phone)) {
        this.showMessage('Numéro de téléphone invalide', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.home.whatsapp)) {
        this.showMessage('Numéro WhatsApp invalide', 'error');
        return false;
      }
    }
    
    if (this.selectedDelivery.method === 'pickup') {
      if (!this.selectedDelivery.pickup.pointId) {
        this.showMessage('Veuillez sélectionner un point de retrait', 'error');
        return false;
      }
    }
    
    if (this.selectedDelivery.method === 'meetup') {
      if (!this.selectedDelivery.meetup.zoneId) {
        this.showMessage('Veuillez sélectionner une zone de rencontre', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.meetup.phone)) {
        this.showMessage('Numéro de téléphone invalide', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.meetup.whatsapp)) {
        this.showMessage('Numéro WhatsApp invalide', 'error');
        return false;
      }
    }
    
    return true;
  }
  
  getDeliveryPayload() {
    const homeZone = this.deliveryData.homeZones.find(z => z.id === this.selectedDelivery.home.zoneId);
    const pickupPoint = this.deliveryData.pickupPoints.find(p => p.id === this.selectedDelivery.pickup.pointId);
    const meetupZone = this.deliveryData.meetupZones.find(z => z.id === this.selectedDelivery.meetup.zoneId);
    return {
      method: this.selectedDelivery.method,
      address: this.selectedDelivery.home.address || '',
      phone: this.selectedDelivery.method === 'home' ? (this.selectedDelivery.home.phone || '') : (this.selectedDelivery.meetup.phone || ''),
      whatsapp: this.selectedDelivery.method === 'home' ? (this.selectedDelivery.home.whatsapp || '') : (this.selectedDelivery.meetup.whatsapp || ''),
      meetupProposal: this.selectedDelivery.meetup.proposal || '',
      homeZone: homeZone || null,
      pickupPoint: pickupPoint || null,
      meetupZone: meetupZone || null,
      weightGrams: this.getCartWeight(),
      baseFee: this.deliveryFees.base,
      weightFee: this.deliveryFees.weightExtra,
      totalFee: this.deliveryFees.total
    };
  }
  
  attachEvents() {
    const closeBtn = this.modal.querySelector('.close-checkout');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
    
    const applyPromo = this.modal.querySelector('.apply-promo');
    const promoInput = this.modal.querySelector('.promo-code');
    
    if (applyPromo && promoInput) {
      applyPromo.addEventListener('click', () => {
        const code = promoInput.value.trim().toUpperCase();
        if (code === 'SIERRA10' || code === 'VITCHSTUDIO10') {
          this.applyDiscount(0.1);
          this.showMessage('Code promo appliqué : 10% de réduction !', 'success');
        } else {
          this.showMessage('Code promo invalide', 'error');
        }
      });
    }
    
    const payBtn = this.modal.querySelector('.pay-now-btn');
    if (payBtn) {
      payBtn.addEventListener('click', () => this.openPaymentModal());
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    this.bindDeliveryEvents();
  }
  
  applyDiscount(percentage) {
    const discount = this.subtotal * percentage;
    this.subtotal -= discount;
    this.calculateTotals();
    
    const totalsDiv = this.modal.querySelector('[style*="max-width: 400px"]');
    if (totalsDiv) {
      const newTotals = `
        <div style="
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
          font-size: 1rem;
          color: #2E5D3A;
        ">
          <span>Réduction (10%)</span>
          <span>-${this.formatPrice(discount)}</span>
        </div>
        ${totalsDiv.innerHTML}
      `;
      totalsDiv.innerHTML = newTotals;
    }
  }
  
  showMessage(message, type = 'success') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#2E5D3A' : '#7F1D1D'};
      color: white;
      padding: 1rem 2rem;
      border-radius: 50px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      z-index: 1000001;
      animation: slideInRight 0.3s ease;
      font-size: 0.95rem;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
  
  async openPaymentModal() {
    try {
      if (!this.client || !this.client.id) {
        this.showMessage('Client non disponible. Veuillez vous reconnecter.', 'error');
        return;
      }
      if (!this.validateDelivery()) {
        return;
      }
      const module = await import('./payment.js');
      const PaymentModal = module.default;
      
      await this.close();
      
      this.paymentModal = new PaymentModal({
        amount: this.total,
        client: this.client,
        cart: this.cart,
        delivery: this.getDeliveryPayload(),
        onClose: () => {
          this.paymentModal = null;
        },
        onSuccess: (orderData) => {
          
          localStorage.removeItem('veltrixa_cart');
          
          const event = new CustomEvent('cartUpdated', { detail: { count: 0 } });
          document.dispatchEvent(event);
          
          if (this.options.onSuccess) {
            this.options.onSuccess(orderData);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur ouverture payment modal:', error);
      this.showMessage('Erreur lors de l\'ouverture du paiement', 'error');
    }
  }
  
  animateIn() {
    setTimeout(() => {
      this.modal.style.opacity = '1';
    }, 50);
  }
  
  animateOut() {
    return new Promise(resolve => {
      this.modal.style.opacity = '0';
      const container = this.modal.querySelector('.checkout-container-' + this.uniqueId);
      if (container) {
        container.style.transform = 'scale(0.95)';
      }
      setTimeout(resolve, 300);
    });
  }
  
  async close() {
    await this.animateOut();
    this.modal.remove();
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
}

export default CheckoutModal;
