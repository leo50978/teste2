// ============= PAYMENT COMPONENT - PROCESSUS DE PAIEMENT =============
import { db } from './firebase-init.js';
import { 
  collection, query, where, getDocs, addDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class PaymentModal {
  constructor(options = {}) {
    this.options = {
      amount: 0,
      client: null,
      cart: [],
      methodId: null,
      onClose: null,
      onSuccess: null,
      imageBasePath: './',
      delivery: null,
      ...options
    };
    
    this.uniqueId = 'payment_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.methods = [];
    this.method = null;
    this.steps = [];
    this.currentStep = 0;
    this.clientData = this.options.client ? { ...this.options.client } : {};
    this.selectedMethod = null;
    this.settings = null;
    this.countdownInterval = null;
    this.timeLeft = 0;
    this.proofImageFile = null;
    this.extractedText = '';
    this.isSubmitted = false;
    this.isCompleted = false;
    
    this.init();
  }
  
  async init() {
    await this.loadSettings();
    await this.loadPaymentMethods();
    this.render();
    this.attachEvents();
    this.animateIn();
    
    document.body.style.overflow = 'hidden';
  }
  
  async loadSettings() {
    try {
      const q = query(collection(db, 'settings'));
      const snapshot = await getDocs(q);
      
      if (!snapshot.empty) {
        this.settings = snapshot.docs[0].data();
      } else {
        this.settings = {
          verificationHours: 12,
          expiredMessage: 'Le délai de vérification est dépassé. Contactez le support.'
        };
      }
    } catch (error) {
      console.error('❌ Erreur chargement paramètres:', error);
      this.settings = { verificationHours: 12 };
    }
  }
  
  async loadPaymentMethods() {
    try {
      const q = query(collection(db, 'paymentMethods'), where('isActive', '==', true));
      const snapshot = await getDocs(q);
      this.methods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      
      if (this.options.methodId) {
        this.selectedMethod = this.methods.find(m => m.id === this.options.methodId);
        if (this.selectedMethod) {
          this.steps = this.selectedMethod.steps || [];
          this.currentStep = 1;
        }
      }
      
      if (this.methods.length === 1 && !this.selectedMethod) {
        this.selectedMethod = this.methods[0];
        this.steps = this.selectedMethod.steps || [];
        this.currentStep = 1;
      }
    } catch (error) {
      console.error('❌ Erreur chargement méthodes:', error);
      this.methods = [];
    }
  }
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    const cleanName = filename.split('/').pop();
    return `${this.options.imageBasePath}${cleanName}`;
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-FR', { 
      style: 'currency', 
      currency: 'HTG',
      minimumFractionDigits: 0
    }).format(price || 0);
  }
  
  render() {
    this.modal = document.createElement('div');
    this.modal.className = `payment-modal-${this.uniqueId}`;
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
      <div class="payment-container-${this.uniqueId}" style="
        background: #F5F1E8;
        border-radius: 1.5rem;
        width: 100%;
        max-width: 600px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        transform: scale(0.95);
        transition: transform 0.3s ease;
        position: relative;
      ">
        <!-- Header avec progression -->
        <div style="
          position: sticky;
          top: 0;
          background: #F5F1E8;
          border-bottom: 1px solid rgba(198, 167, 94, 0.2);
          padding: 1.5rem;
          z-index: 10;
          border-radius: 1.5rem 1.5rem 0 0;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <div style="display: flex; align-items: center; gap: 1rem;">
              ${this.currentStep > 0 ? `
                <button class="back-step" style="
                  background: none;
                  border: none;
                  font-size: 1.2rem;
                  cursor: pointer;
                  color: #8B7E6B;
                  padding: 0.5rem;
                  width: 40px;
                  height: 40px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  border-radius: 50%;
                  transition: all 0.2s;
                " onmouseover="this.style.background='rgba(198,167,94,0.1)'; this.style.color='#C6A75E'" onmouseout="this.style.background='transparent'; this.style.color='#8B7E6B'">
                  <i class="fas fa-arrow-left"></i>
                </button>
              ` : ''}
              <h2 style="
                font-family: 'Cormorant Garamond', serif;
                font-size: 1.5rem;
                color: #1F1E1C;
                margin: 0;
              ">
                Paiement sécurisé
              </h2>
            </div>
            <button class="close-payment" style="
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
          
          ${this.renderProgressBar()}
        </div>
        
        <div style="padding: 1.5rem;">
          ${this.renderCurrentStep()}
        </div>
      </div>
      
      <style>
        .payment-container-${this.uniqueId} {
          animation: paymentSlideIn 0.3s ease forwards;
        }
        
        @keyframes paymentSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .payment-container-${this.uniqueId}::-webkit-scrollbar {
          width: 6px;
        }
        
        .payment-container-${this.uniqueId}::-webkit-scrollbar-track {
          background: rgba(198, 167, 94, 0.1);
          border-radius: 3px;
        }
        
        .payment-container-${this.uniqueId}::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 3px;
        }
        
        .method-card {
          transition: all 0.2s;
          cursor: pointer;
        }
        
        .method-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .method-card.selected {
          border-color: #C6A75E !important;
          background: rgba(198, 167, 94, 0.05);
        }
        
        .countdown-timer {
          font-family: monospace;
          font-size: 1.5rem;
          font-weight: bold;
          color: #C6A75E;
        }
        
        .form-group {
          margin-bottom: 1rem;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 0.25rem;
          font-size: 0.9rem;
          color: #8B7E6B;
        }
        
        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 0.75rem;
          border: 1px solid rgba(198, 167, 94, 0.3);
          border-radius: 0.5rem;
          background: white;
          font-size: 0.95rem;
        }
        
        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
          outline: none;
          border-color: #C6A75E;
        }
        
        .next-step-btn {
          width: 100%;
          background: #1F1E1C;
          color: #F5F1E8;
          border: 1px solid #C6A75E;
          padding: 1rem;
          border-radius: 0.5rem;
          font-size: 1rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 1.5rem;
        }
        
        .next-step-btn:hover {
          background: #C6A75E;
          color: #1F1E1C;
        }
        
        .next-step-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .warning-message {
          background: rgba(183, 110, 46, 0.1);
          border-left: 4px solid #B76E2E;
          padding: 1rem;
          border-radius: 0.5rem;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
        }
        
        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .ocr-progress {
          margin-top: 1rem;
          padding: 1rem;
          background: rgba(198, 167, 94, 0.1);
          border-radius: 0.5rem;
          text-align: center;
        }
        
        .ocr-progress .progress-bar {
          width: 100%;
          height: 4px;
          background: rgba(198, 167, 94, 0.2);
          border-radius: 2px;
          margin: 0.5rem 0;
          overflow: hidden;
        }
        
        .ocr-progress .progress-bar-fill {
          height: 100%;
          background: #C6A75E;
          transition: width 0.3s ease;
        }
        
        .extracted-text {
          margin-top: 1rem;
          padding: 1rem;
          background: #F5F1E8;
          border: 1px solid rgba(198, 167, 94, 0.3);
          border-radius: 0.5rem;
          font-family: monospace;
          font-size: 0.9rem;
          max-height: 150px;
          overflow-y: auto;
        }
      </style>
    `;
    
    document.body.appendChild(this.modal);
  }
  
  renderProgressBar() {
    const totalSteps = 1 + (this.steps?.length || 0);
    const currentStepDisplay = this.currentStep + 1;
    const progress = (currentStepDisplay / totalSteps) * 100;
    
    return `
      <div style="margin-top: 0.5rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
          <span style="font-size: 0.85rem; color: #8B7E6B;">Étape ${currentStepDisplay}/${totalSteps}</span>
          <span style="font-size: 0.85rem; color: #8B7E6B;">${Math.round(progress)}%</span>
        </div>
        <div style="
          width: 100%;
          height: 4px;
          background: rgba(198, 167, 94, 0.2);
          border-radius: 2px;
          overflow: hidden;
        ">
          <div style="
            width: ${progress}%;
            height: 100%;
            background: #C6A75E;
            transition: width 0.3s ease;
          "></div>
        </div>
      </div>
    `;
  }
  
  renderCurrentStep() {
    if (this.currentStep === 0) {
      return this.renderStep0();
    }
    
    if (!this.steps || this.steps.length === 0) {
      return this.renderNoSteps();
    }
    
    const stepIndex = this.currentStep - 1;
    const step = this.steps[stepIndex];
    
    if (!step) {
      return this.renderNoSteps();
    }
    
    switch(step.type) {
      case 'form':
        return this.renderFormStep(step);
      case 'payment':
        return this.renderPaymentStep(step);
      case 'proof':
        return this.renderProofStep(step);
      case 'confirmation':
        return this.renderConfirmationStep(step);
      default:
        return this.renderCustomStep(step);
    }
  }
  
  renderStep0() {
    if (this.methods.length === 0) {
      return `
        <div style="text-align: center; padding: 2rem;">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #B76E2E; margin-bottom: 1rem;"></i>
          <h3 style="font-size: 1.2rem; margin-bottom: 1rem;">Aucune méthode disponible</h3>
          <p style="color: #8B7E6B;">Veuillez réessayer plus tard.</p>
        </div>
      `;
    }
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">Choisissez votre méthode de paiement</h3>
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">Sélectionnez parmi nos options disponibles</p>
        
        <div id="methodsList" style="display: flex; flex-direction: column; gap: 1rem;">
          ${this.methods.map(method => this.renderMethodCard(method)).join('')}
        </div>
      </div>
    `;
  }
  
  renderMethodCard(method) {
    const isSelected = this.selectedMethod?.id === method.id;
    
    return `
      <div class="method-card" data-method-id="${method.id}" style="
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 1rem;
        border: 2px solid ${isSelected ? '#C6A75E' : 'rgba(198,167,94,0.2)'};
        border-radius: 0.75rem;
        background: white;
        cursor: pointer;
      ">
        <div style="
          width: 60px;
          height: 60px;
          min-width: 60px;
          min-height: 60px;
          flex-shrink: 0;
          background: rgba(198,167,94,0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        ">
          ${method.image ? 
            `<img src="${this.getImagePath(method.image)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fas fa-money-bill-wave\' style=\'font-size: 1.5rem; color: #C6A75E;\'></i>';">` : 
            `<i class="fas fa-money-bill-wave" style="font-size: 1.5rem; color: #C6A75E;"></i>`
          }
        </div>
        <div style="flex: 1;">
          <h4 style="font-weight: 600; margin-bottom: 0.25rem;">${method.name}</h4>
          <p style="font-size: 0.85rem; color: #8B7E6B;">${method.instructions || ''}</p>
        </div>
        <div style="width: 24px; height: 24px; min-width: 24px; min-height: 24px; flex-shrink: 0; border-radius: 50%; border: 2px solid #C6A75E; display: flex; align-items: center; justify-content: center;">
          ${isSelected ? '<div style="width: 12px; height: 12px; border-radius: 50%; background: #C6A75E;"></div>' : ''}
        </div>
      </div>
    `;
  }
  
  renderFormStep(step) {
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 0.5rem;">${step.title || 'Vos informations'}</h3>
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">${step.description || ''}</p>
        
        <form id="clientForm" class="space-y-4">
          ${step.fields?.map(field => this.renderFormField(field)).join('') || ''}
        </form>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${step.buttonText || 'Continuer'}
        </button>
      </div>
    `;
  }
  
  renderFormField(field) {
    const value = this.clientData[field.name] || '';
    const required = field.required ? 'required' : '';
    
    switch(field.type) {
      case 'textarea':
        return `
          <div class="form-group">
            <label>${field.label}${field.required ? ' *' : ''}</label>
            <textarea name="${field.name}" ${required} rows="3">${value}</textarea>
          </div>
        `;
      case 'select':
        return `
          <div class="form-group">
            <label>${field.label}${field.required ? ' *' : ''}</label>
            <select name="${field.name}" ${required}>
              <option value="">Sélectionnez...</option>
              ${field.options?.map(opt => `
                <option value="${opt}" ${value === opt ? 'selected' : ''}>${opt}</option>
              `).join('') || ''}
            </select>
          </div>
        `;
      case 'checkbox':
        return `
          <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem;">
            <input type="checkbox" name="${field.name}" id="${field.name}" ${value ? 'checked' : ''}>
            <label for="${field.name}" style="margin: 0;">${field.label}${field.required ? ' *' : ''}</label>
          </div>
        `;
      default:
        return `
          <div class="form-group">
            <label>${field.label}${field.required ? ' *' : ''}</label>
            <input type="${field.type || 'text'}" name="${field.name}" value="${value}" ${required}>
          </div>
        `;
    }
  }
  
  renderPaymentStep(step) {
    if (!this.selectedMethod) {
      return '<p class="text-accent">Veuillez d\'abord sélectionner une méthode</p>';
    }
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${step.title || 'Effectuez le paiement'}</h3>
        
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">${step.instruction || 'Payez aux coordonnées suivantes :'}</p>
        
        <div style="
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        ">
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem;">
            <div style="
              width: 60px;
              height: 60px;
              background: rgba(198,167,94,0.1);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            ">
              ${this.selectedMethod.image ? 
                `<img src="${this.getImagePath(this.selectedMethod.image)}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none';this.parentElement.innerHTML='<i class=\'fas fa-university\' style=\'font-size: 1.5rem; color: #C6A75E;\'></i>';">` : 
                `<i class="fas fa-university" style="font-size: 1.5rem; color: #C6A75E;"></i>`
              }
            </div>
            <div>
              <h4 style="font-weight: 600;">${this.selectedMethod.name}</h4>
              <p style="font-size: 0.85rem; color: #8B7E6B;">${this.selectedMethod.accountName}</p>
            </div>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
            border-top: 1px solid rgba(198,167,94,0.2);
            border-bottom: 1px solid rgba(198,167,94,0.2);
          ">
            <span style="color: #8B7E6B;">Téléphone</span>
            <span style="font-weight: 500;">${this.selectedMethod.phoneNumber}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
          ">
            <span style="color: #8B7E6B;">Montant</span>
            <span style="font-weight: bold; font-size: 1.2rem;">${this.formatPrice(this.options.amount || 0)}</span>
          </div>
          
          ${this.selectedMethod.qrCode ? `
            <div style="
              display: flex;
              flex-direction: column;
              align-items: center;
              padding: 1rem;
              background: #F5F1E8;
              border-radius: 0.5rem;
            ">
              <p style="font-size: 0.85rem; color: #8B7E6B; margin-bottom: 0.5rem;">Scannez le QR code</p>
              <img src="${this.getImagePath(this.selectedMethod.qrCode)}" style="width: 150px; height: 150px; object-fit: contain;" onerror="this.style.display='none'">
            </div>
          ` : ''}
        </div>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${step.buttonText || 'J\'ai payé'}
        </button>
      </div>
    `;
  }
  
  renderProofStep(step) {
    const expectedName = this.clientData.fullName || this.clientData.name || this.options.client?.name || '';
    
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${step.title || 'Confirmez votre paiement'}</h3>
        
        ${expectedName ? `
          <div class="warning-message">
            <i class="fas fa-exclamation-triangle" style="color: #B76E2E; margin-right: 0.5rem;"></i>
            <strong>Important :</strong> Le nom que vous saisissez doit correspondre exactement à celui de l'étape précédente : 
            <strong style="color: #1F1E1C;">${expectedName}</strong>
          </div>
        ` : ''}
        
        <p style="color: #8B7E6B; margin-bottom: 1.5rem;">${step.message || 'Téléchargez une capture d\'écran de votre transaction'}</p>
        
        <form id="proofForm" class="space-y-4">
          <div class="form-group">
            <label>Confirmez votre nom *</label>
            <input type="text" id="proofName" required placeholder="Votre nom exact" value="${expectedName}">
          </div>
          
          <div class="form-group">
            <label>Capture d'écran de la transaction *</label>
            <input type="file" id="proofImage" accept="image/*" required>
            <p style="font-size: 0.8rem; color: #8B7E6B; margin-top: 0.25rem;">Format accepté : JPG, PNG (max 5 Mo)</p>
          </div>
          
          <div id="imagePreview" style="display: none; margin-top: 1rem; text-align: center;">
            <img id="previewImg" style="max-width: 100%; max-height: 200px; border-radius: 0.5rem; border: 1px solid rgba(198,167,94,0.3);">
          </div>
        </form>
        
        <div id="ocrProgress" class="ocr-progress" style="display: none;">
          <div class="ocr-status">Analyse de l'image en cours...</div>
          <div class="progress-bar">
            <div class="progress-bar-fill" id="ocrProgressFill" style="width: 0%;"></div>
          </div>
        </div>
        
        <div id="extractedTextContainer" class="extracted-text" style="display: none;">
          <strong>Texte extrait :</strong>
          <div id="extractedTextContent"></div>
        </div>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${step.buttonText || 'Soumettre ma demande'}
        </button>
      </div>
    `;
  }
  
  renderConfirmationStep(step) {
    this.startCountdown();
    
    return `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="
          width: 100px;
          height: 100px;
          background: #2E5D3A;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        ">
          <i class="fas fa-check" style="font-size: 3rem; color: white;"></i>
        </div>
        
        <h3 style="font-size: 1.5rem; margin-bottom: 1rem;">Demande soumise avec succès !</h3>
        
        <p style="color: #8B7E6B; margin-bottom: 2rem;">
          ${step.message || 'Votre demande est en cours de vérification. Elle sera traitée sous 12 heures.'}
        </p>
        
        <div style="
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          margin-bottom: 1.5rem;
        ">
          <p style="font-size: 0.9rem; color: #8B7E6B; margin-bottom: 0.5rem;">Temps restant avant vérification</p>
          <div class="countdown-timer" id="countdownTimer">12:00:00</div>
        </div>
        
        <p style="font-size: 0.9rem; color: #8B7E6B;">
          <i class="fas fa-clock" style="margin-right: 0.3rem;"></i>
          Vous pourrez suivre le statut de votre demande dans votre panier
        </p>
        
        <button class="next-step-btn" id="closeAfterConfirmation" style="margin-top: 2rem;">
          Fermer
        </button>
      </div>
    `;
  }
  
  renderCustomStep(step) {
    return `
      <div>
        <h3 style="font-size: 1.3rem; margin-bottom: 1rem;">${step.title || 'Étape personnalisée'}</h3>
        <div style="
          background: white;
          border-radius: 1rem;
          padding: 1.5rem;
          white-space: pre-line;
        ">
          ${step.content || ''}
        </div>
        
        <button class="next-step-btn" id="nextStepBtn">
          ${step.buttonText || 'Continuer'}
        </button>
      </div>
    `;
  }
  
  renderNoSteps() {
    return `
      <div style="text-align: center; padding: 2rem;">
        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #B76E2E; margin-bottom: 1rem;"></i>
        <h3 style="font-size: 1.2rem; margin-bottom: 1rem;">Configuration incomplète</h3>
        <p style="color: #8B7E6B;">Cette méthode de paiement n'est pas correctement configurée.</p>
      </div>
    `;
  }
  
  attachEvents() {
    const closeBtn = this.modal.querySelector('.close-payment');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    const backBtn = this.modal.querySelector('.back-step');
    if (backBtn) {
      backBtn.addEventListener('click', () => this.goBack());
    }
    
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
    
    if (this.currentStep === 0) {
      this.attachStep0Events();
    } else {
      this.attachStepEvents();
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }
  
  attachStep0Events() {
    const methodsList = this.modal.querySelector('#methodsList');
    
    if (methodsList) {
      methodsList.querySelectorAll('.method-card').forEach(card => {
        card.addEventListener('click', () => {
          const methodId = card.dataset.methodId;
          const method = this.methods.find(m => m.id === methodId);
          
          if (method) {
            this.selectedMethod = method;
            this.steps = this.selectedMethod.steps || [];
            this.currentStep = 1;
            this.skipPaymentStepsForward();
            this.updateStepDisplay();
          }
        });
      });
    }
  }

  skipPaymentStepsForward() {
    while (
      this.currentStep >= 1 &&
      this.currentStep <= (this.steps?.length || 0) &&
      this.steps[this.currentStep - 1]?.type === 'payment'
    ) {
      this.currentStep++;
    }
  }

  skipPaymentStepsBackward() {
    while (
      this.currentStep >= 1 &&
      this.steps[this.currentStep - 1]?.type === 'payment'
    ) {
      this.currentStep--;
    }
  }
  
  attachStepEvents() {
    const nextBtn = this.modal.querySelector('#nextStepBtn');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.handleNextStep());
    }
    
    const closeBtn = this.modal.querySelector('#closeAfterConfirmation');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    const proofImage = this.modal.querySelector('#proofImage');
    if (proofImage) {
      proofImage.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 5 * 1024 * 1024) {
            alert('L\'image est trop volumineuse. Taille maximum : 5 Mo');
            proofImage.value = '';
            return;
          }
          
          const reader = new FileReader();
          reader.onload = (e) => {
            const preview = this.modal.querySelector('#imagePreview');
            const img = this.modal.querySelector('#previewImg');
            if (preview && img) {
              img.src = e.target.result;
              preview.style.display = 'block';
            }
            this.proofImageFile = file;
          };
          reader.readAsDataURL(file);
        }
      });
    }
  }
  
  goBack() {
    if (this.currentStep > 0 && this.currentStep < this.steps.length) {
      this.currentStep--;
      this.skipPaymentStepsBackward();
      this.updateStepDisplay();
    }
  }
  
  async handleNextStep() {
    const stepIndex = this.currentStep - 1;
    const step = this.steps[stepIndex];
    
    if (!step) return;
    
    const nextBtn = this.modal.querySelector('#nextStepBtn');
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = '<div class="loading-spinner"></div> Traitement...';
    }
    
    try {
      let isValid = true;
      
      switch(step.type) {
        case 'form':
          isValid = this.validateFormStep();
          break;
        case 'proof':
          isValid = await this.validateProofStep();
          break;
        case 'payment':
          break;
        default:
          break;
      }
      
      if (!isValid) {
        if (nextBtn) {
          nextBtn.disabled = false;
          nextBtn.innerHTML = step.buttonText || 'Continuer';
        }
        return;
      }
      
      if (step.type === 'proof') {
        this.isSubmitted = true;
        this.isCompleted = true;
        
        this.currentStep++;
        this.skipPaymentStepsForward();
        this.updateStepDisplay();
        
        return;
      }
      
      if (this.currentStep < this.steps.length) {
        this.currentStep++;
        this.skipPaymentStepsForward();
        this.updateStepDisplay();
      }
    } catch (error) {
      console.error('❌ Erreur:', error);
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = step.buttonText || 'Continuer';
      }
      alert('Une erreur est survenue. Veuillez réessayer.');
    }
  }
  
  validateFormStep() {
    const form = this.modal.querySelector('#clientForm');
    if (!form) return false;
    
    const inputs = form.querySelectorAll('input, textarea, select');
    let isValid = true;
    let firstInvalid = null;
    
    inputs.forEach(input => {
      if (input.hasAttribute('required') && !input.value.trim()) {
        input.style.borderColor = '#7F1D1D';
        isValid = false;
        if (!firstInvalid) firstInvalid = input;
      } else {
        input.style.borderColor = 'rgba(198,167,94,0.3)';
      }
    });
    
    if (!isValid && firstInvalid) {
      firstInvalid.focus();
      alert('Veuillez remplir tous les champs obligatoires');
      return false;
    }
    
    if (isValid) {
      inputs.forEach(input => {
        if (input.type === 'checkbox') {
          this.clientData[input.name] = input.checked;
        } else {
          this.clientData[input.name] = input.value.trim();
        }
      });
    }
    
    return isValid;
  }
  
  async validateProofStep() {
    const proofName = this.modal.querySelector('#proofName')?.value.trim();
    const proofImage = this.modal.querySelector('#proofImage')?.files[0];
    
    if (!proofName) {
      alert('Veuillez confirmer votre nom');
      return false;
    }
    
    const expectedName = this.clientData.fullName || this.clientData.name || this.options.client?.name || '';
    if (expectedName && proofName !== expectedName) {
      alert(`Le nom "${proofName}" ne correspond pas à "${expectedName}". Veuillez saisir le même nom.`);
      return false;
    }
    
    if (!proofImage && !this.proofImageFile) {
      alert('Veuillez sélectionner une image');
      return false;
    }
    
    const imageFile = this.proofImageFile || proofImage;
    
    const ocrProgress = this.modal.querySelector('#ocrProgress');
    const extractedTextContainer = this.modal.querySelector('#extractedTextContainer');
    const extractedTextContent = this.modal.querySelector('#extractedTextContent');
    const ocrProgressFill = this.modal.querySelector('#ocrProgressFill');
    
    if (ocrProgress) {
      ocrProgress.style.display = 'block';
    }
    
    try {
      if (typeof Tesseract !== 'undefined') {
        const result = await Tesseract.recognize(
          imageFile,
          'fra',
          {
            logger: m => {
              if (m.status === 'recognizing text' && ocrProgressFill) {
                ocrProgressFill.style.width = (m.progress * 100) + '%';
              }
            }
          }
        );
        
        if (ocrProgressFill) {
          ocrProgressFill.style.width = '100%';
        }
        
        this.extractedText = result.data.text;
        
        if (extractedTextContainer && extractedTextContent) {
          extractedTextContainer.style.display = 'block';
          extractedTextContent.textContent = this.extractedText || 'Aucun texte détecté';
        }
        
      } else {
        console.warn('⚠️ Tesseract non disponible');
      }
    } catch (ocrError) {
      console.error('❌ Erreur OCR:', ocrError);
      this.extractedText = 'Erreur lors de l\'extraction du texte';
    }
    
    await this.saveOrder(proofName);
    
    return true;
  }
  
  async saveOrder(proofName) {
    try {
      if (!this.options.client || !this.options.client.id) {
        console.error('❌ Client non disponible');
        return false;
      }

      const normalizedItems = Array.isArray(this.options.cart)
        ? this.options.cart.map((item) => {
            const quantity = Number(item?.quantity) || 1;
            const price = Number(item?.price) || 0;
            return {
              productId: item?.productId || '',
              name: item?.name || 'Produit',
              price,
              quantity,
              sku: item?.sku || '',
              image: item?.image || '',
              selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : []
            };
          })
        : [];
      const computedAmount = normalizedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const finalAmount = Number(this.options.amount) || computedAmount;
      
      const uniqueCode = 'VLX-' + Math.random().toString(36).substr(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
      
      const orderData = {
        amount: finalAmount,
        clientId: this.options.client?.id || '',
        clientUid: this.options.client?.uid || '',
        methodId: this.selectedMethod?.id,
        methodName: this.selectedMethod?.name,
        methodDetails: {
          name: this.selectedMethod?.name,
          accountName: this.selectedMethod?.accountName,
          phoneNumber: this.selectedMethod?.phoneNumber
        },
        delivery: this.options.delivery || null,
        shippingAmount: Number(this.options.delivery?.totalFee || 0),
        weightFee: Number(this.options.delivery?.weightFee || 0),
        items: normalizedItems,
        status: 'pending',
        uniqueCode: uniqueCode,
        extractedText: this.extractedText,
        proofName: proofName,
        clientData: this.clientData,
        customerName: this.clientData.fullName || this.clientData.name || this.options.client?.name || '',
        customerEmail: this.clientData.email || this.options.client?.email || '',
        customerPhone: this.clientData.phone || this.options.client?.phone || '',
        customerAddress: this.clientData.address || this.options.client?.address || '',
        customerCity: this.clientData.city || this.options.client?.city || '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ((this.settings.verificationHours || 12) * 60 * 60 * 1000)).toISOString()
      };
      
      
      // Référence vers la sous-collection orders du client
      const ordersRef = collection(db, 'clients', this.options.client.id, 'orders');
      const docRef = await addDoc(ordersRef, orderData);
      
      document.dispatchEvent(new CustomEvent('orderSaved', {
        detail: { id: docRef.id, clientId: this.options.client.id, order: orderData }
      }));
      
      if (this.options.onSuccess) {
        this.options.onSuccess({ id: docRef.id, ...orderData });
      }
      
      return true;
    } catch (error) {
      console.error('❌ Erreur sauvegarde commande:', error);
      throw error;
    }
  }
  
  updateStepDisplay() {
    const header = this.modal.querySelector('.payment-container-' + this.uniqueId + ' > div:first-child');
    if (header) {
      const titleDiv = header.querySelector('div:first-child');
      if (titleDiv) {
        titleDiv.innerHTML = `
          <div style="display: flex; align-items: center; gap: 1rem;">
            ${this.currentStep > 0 && this.currentStep < (this.steps?.length || 0) && !this.isSubmitted ? `
              <button class="back-step" style="
                background: none;
                border: none;
                font-size: 1.2rem;
                cursor: pointer;
                color: #8B7E6B;
                padding: 0.5rem;
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: all 0.2s;
              " onmouseover="this.style.background='rgba(198,167,94,0.1)'; this.style.color='#C6A75E'" onmouseout="this.style.background='transparent'; this.style.color='#8B7E6B'">
                <i class="fas fa-arrow-left"></i>
              </button>
            ` : ''}
            <h2 style="
              font-family: 'Cormorant Garamond', serif;
              font-size: 1.5rem;
              color: #1F1E1C;
              margin: 0;
            ">
              Paiement sécurisé
            </h2>
          </div>
          <button class="close-payment" style="
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
        `;
      }
      
      const oldProgress = header.querySelector('div[style*="margin-top: 0.5rem"]');
      if (oldProgress) {
        oldProgress.remove();
      }
      
      if (this.currentStep < (this.steps?.length || 0) && !this.isSubmitted) {
        const newProgress = document.createElement('div');
        newProgress.innerHTML = this.renderProgressBar();
        header.appendChild(newProgress.firstChild);
      }
    }
    
    const content = this.modal.querySelector('.payment-container-' + this.uniqueId + ' > div:nth-child(2)');
    if (content) {
      content.innerHTML = this.renderCurrentStep();
    }
    
    this.attachEvents();
  }
  
  startCountdown() {
    const hours = this.settings.verificationHours || 12;
    this.timeLeft = hours * 60 * 60;
    
    const updateTimer = () => {
      if (this.timeLeft <= 0) {
        clearInterval(this.countdownInterval);
        const timer = this.modal.querySelector('#countdownTimer');
        if (timer) {
          timer.textContent = 'Expiré';
          timer.style.color = '#7F1D1D';
        }
        return;
      }
      
      const h = Math.floor(this.timeLeft / 3600);
      const m = Math.floor((this.timeLeft % 3600) / 60);
      const s = this.timeLeft % 60;
      
      const timer = this.modal.querySelector('#countdownTimer');
      if (timer) {
        timer.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
      
      this.timeLeft--;
    };
    
    updateTimer();
    this.countdownInterval = setInterval(updateTimer, 1000);
  }
  
  animateIn() {
    setTimeout(() => {
      this.modal.style.opacity = '1';
    }, 50);
  }
  
  animateOut() {
    return new Promise(resolve => {
      this.modal.style.opacity = '0';
      const container = this.modal.querySelector('.payment-container-' + this.uniqueId);
      if (container) {
        container.style.transform = 'scale(0.95)';
      }
      setTimeout(resolve, 300);
    });
  }
  
  async close() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
    }
    
    await this.animateOut();
    this.modal.remove();
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
}

export default PaymentModal;
