// ============= AUTH COMPONENT - GESTIONNAIRE D'AUTHENTIFICATION =============
import { auth, googleProvider } from './firebase-init.js';
import { 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

class AuthManager {
  constructor(options = {}) {
    this.options = {
      onAuthChange: null,
      ...options
    };
    
    this.currentUser = null;
    this.hasAuthInitialized = false;
    this.modal = null;
    this.uniqueId = 'auth_' + Math.random().toString(36).substr(2, 9);
    this.isModalOpen = false;
    
    this.init();
  }
  
  init() {
    // Écouter les changements d'authentification
    onAuthStateChanged(auth, (user) => {
      const previousUser = this.currentUser;
      this.currentUser = user;

      if (this.hasAuthInitialized) {
        const wasAuthenticated = !!previousUser;
        const isAuthenticated = !!user;

        if (!wasAuthenticated && isAuthenticated) {
          const label = user?.displayName || user?.email || 'utilisateur';
          this.showToast(`Connexion réussie. Bienvenue ${label}.`, 'success');
        } else if (wasAuthenticated && !isAuthenticated) {
          this.showToast('Déconnexion réussie.', 'info');
        }
      }

      this.hasAuthInitialized = true;
      
      // Émettre un événement
      const event = new CustomEvent('authChanged', { 
        detail: { 
          user: user,
          isAuthenticated: !!user,
          email: user?.email,
          displayName: user?.displayName,
          uid: user?.uid
        }
      });
      document.dispatchEvent(event);
      
      if (this.options.onAuthChange) {
        this.options.onAuthChange(user);
      }
    });
  }
  
  // Ouvrir le modal de connexion
  openAuthModal(mode = 'login') {
    // Éviter d'ouvrir plusieurs modals
    if (this.isModalOpen) {
      return;
    }
    
    this.isModalOpen = true;
    
    if (this.modal) {
      this.modal.remove();
    }
    
    this.modal = document.createElement('div');
    this.modal.className = `auth-modal-${this.uniqueId}`;
    this.renderAuthModal(mode);
    document.body.appendChild(this.modal);
    
    // Forcer le style display: flex sur l'overlay
    const overlay = this.modal.querySelector('.auth-overlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
    
    // Animation d'entrée
    setTimeout(() => {
      const container = this.modal.querySelector('.auth-container');
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
      }
    }, 50);
    
    document.body.style.overflow = 'hidden';
  }
  
  // Fermer le modal
  closeAuthModal() {
    if (!this.modal) {
      this.isModalOpen = false;
      return;
    }
    
    const overlay = this.modal.querySelector('.auth-overlay');
    const container = this.modal.querySelector('.auth-container');
    
    if (overlay) overlay.style.opacity = '0';
    if (container) {
      container.style.opacity = '0';
      container.style.transform = 'translateY(20px)';
    }
    
    setTimeout(() => {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
      this.isModalOpen = false;
      document.body.style.overflow = '';
    }, 300);
  }
  
  // Rendre le modal d'authentification
  renderAuthModal(mode = 'login') {
    this.modal.innerHTML = `
      <div class="auth-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        z-index: 1000000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        opacity: 0;
        transition: opacity 0.3s ease;
      ">
        <div class="auth-container" style="
          background: #F5F1E8;
          border-radius: 1.5rem;
          width: 100%;
          max-width: 400px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.3s ease;
          padding: 2rem;
        ">
          <!-- Header -->
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
          ">
            <h2 style="
              font-family: 'Cormorant Garamond', serif;
              font-size: 1.8rem;
              color: #1F1E1C;
              margin: 0;
            ">
              ${mode === 'login' ? 'Connexion' : 'Inscription'}
            </h2>
            <button class="close-auth" style="
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
          
          <!-- Formulaire -->
          <form id="authForm" class="space-y-4">
            ${mode === 'register' ? `
              <div>
                <label style="
                  display: block;
                  margin-bottom: 0.5rem;
                  font-size: 0.9rem;
                  color: #8B7E6B;
                ">Nom complet</label>
                <input type="text" id="displayName" required style="
                  width: 100%;
                  padding: 0.75rem;
                  border: 1px solid rgba(198, 167, 94, 0.3);
                  border-radius: 0.5rem;
                  font-size: 1rem;
                  background: white;
                " placeholder="Jean Dupont">
              </div>
            ` : ''}
            
            <div>
              <label style="
                display: block;
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
                color: #8B7E6B;
              ">Email</label>
              <input type="email" id="email" required style="
                width: 100%;
                padding: 0.75rem;
                border: 1px solid rgba(198, 167, 94, 0.3);
                border-radius: 0.5rem;
                font-size: 1rem;
                background: white;
              " placeholder="email@exemple.com">
            </div>
            
            <div>
              <label style="
                display: block;
                margin-bottom: 0.5rem;
                font-size: 0.9rem;
                color: #8B7E6B;
              ">Mot de passe</label>
              <input type="password" id="password" required style="
                width: 100%;
                padding: 0.75rem;
                border: 1px solid rgba(198, 167, 94, 0.3);
                border-radius: 0.5rem;
                font-size: 1rem;
                background: white;
              " placeholder="••••••••">
            </div>
            
            ${mode === 'login' ? `
              <div style="text-align: right;">
                <button type="button" id="forgotPassword" style="
                  background: none;
                  border: none;
                  color: #C6A75E;
                  font-size: 0.85rem;
                  cursor: pointer;
                ">Mot de passe oublié ?</button>
              </div>
            ` : ''}
            
            <button type="submit" id="submitAuth" style="
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
              margin-top: 1rem;
            " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
              ${mode === 'login' ? 'Se connecter' : 'S\'inscrire'}
            </button>
          </form>
          
          <!-- Séparateur -->
          <div style="
            display: flex;
            align-items: center;
            gap: 1rem;
            margin: 1.5rem 0;
          ">
            <div style="flex: 1; height: 1px; background: rgba(198, 167, 94, 0.2);"></div>
            <span style="color: #8B7E6B; font-size: 0.9rem;">ou</span>
            <div style="flex: 1; height: 1px; background: rgba(198, 167, 94, 0.2);"></div>
          </div>
          
          <!-- Bouton Google -->
          <button id="googleSignIn" style="
            width: 100%;
            background: white;
            color: #1F1E1C;
            border: 1px solid rgba(198, 167, 94, 0.3);
            padding: 1rem;
            border-radius: 0.5rem;
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
          " onmouseover="this.style.background='#F5F1E8'" onmouseout="this.style.background='white'">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" style="width: 20px; height: 20px;">
            <span>Continuer avec Google</span>
          </button>
          
          <!-- Footer -->
          <div style="
            margin-top: 2rem;
            text-align: center;
            border-top: 1px solid rgba(198, 167, 94, 0.2);
            padding-top: 1.5rem;
          ">
            <p style="color: #8B7E6B; margin-bottom: 0.5rem;">
              ${mode === 'login' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}
            </p>
            <button id="switchMode" style="
              background: none;
              border: none;
              color: #C6A75E;
              font-size: 1rem;
              font-weight: 500;
              cursor: pointer;
            ">
              ${mode === 'login' ? 'Créer un compte' : 'Se connecter'}
            </button>
          </div>
          
          <!-- Message d'erreur -->
          <div id="authError" style="
            margin-top: 1rem;
            padding: 0.75rem;
            border-radius: 0.5rem;
            background: #FEE2E2;
            color: #991B1B;
            font-size: 0.9rem;
            display: none;
          "></div>
        </div>
      </div>
      
      <style>
        .auth-container {
          animation: authSlideIn 0.3s ease forwards;
        }
        
        .auth-container input:focus {
          outline: none;
          border-color: #C6A75E;
          box-shadow: 0 0 0 2px rgba(198, 167, 94, 0.2);
        }
        
        @keyframes authSlideIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      </style>
    `;
    
    this.attachAuthEvents(mode);
  }
  
  // Attacher les événements du modal
  attachAuthEvents(mode) {
    const closeBtn = this.modal.querySelector('.close-auth');
    const overlay = this.modal.querySelector('.auth-overlay');
    const switchBtn = this.modal.querySelector('#switchMode');
    const form = this.modal.querySelector('#authForm');
    const forgotBtn = this.modal.querySelector('#forgotPassword');
    const googleBtn = this.modal.querySelector('#googleSignIn');
    
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAuthModal();
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.closeAuthModal();
      }
    });
    
    switchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeAuthModal();
      setTimeout(() => {
        this.openAuthModal(mode === 'login' ? 'register' : 'login');
      }, 300);
    });
    
    if (forgotBtn) {
      forgotBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleForgotPassword();
      });
    }
    
    if (googleBtn) {
      googleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleGoogleSignIn();
      });
    }
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'login') {
        this.handleLogin();
      } else {
        this.handleRegister();
      }
    });
  }
  
  // Gérer la connexion
  async handleLogin() {
    const email = this.modal.querySelector('#email').value;
    const password = this.modal.querySelector('#password').value;
    const errorDiv = this.modal.querySelector('#authError');
    
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      this.closeAuthModal();
    } catch (error) {
      console.error('❌ Erreur connexion:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // Gérer l'inscription
  async handleRegister() {
    const email = this.modal.querySelector('#email').value;
    const password = this.modal.querySelector('#password').value;
    const displayName = this.modal.querySelector('#displayName')?.value;
    const errorDiv = this.modal.querySelector('#authError');
    
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      if (displayName) {
        await updateProfile(userCredential.user, {
          displayName: displayName
        });
      }
      
      this.closeAuthModal();
    } catch (error) {
      console.error('❌ Erreur inscription:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // Gérer la connexion avec Google
  async handleGoogleSignIn() {
    const errorDiv = this.modal.querySelector('#authError');
    
    try {
      const result = await signInWithPopup(auth, googleProvider);
      this.closeAuthModal();
    } catch (error) {
      console.error('❌ Erreur Google:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // Gérer le mot de passe oublié
  async handleForgotPassword() {
    const email = this.modal.querySelector('#email').value;
    const errorDiv = this.modal.querySelector('#authError');
    
    if (!email) {
      errorDiv.style.display = 'block';
      errorDiv.textContent = 'Veuillez saisir votre email';
      return;
    }
    
    try {
      await sendPasswordResetEmail(auth, email);
      this.showToast('Email de réinitialisation envoyé. Vérifiez votre boîte de réception.', 'success');
      this.closeAuthModal();
    } catch (error) {
      console.error('❌ Erreur:', error);
      errorDiv.style.display = 'block';
      errorDiv.textContent = this.getErrorMessage(error.code);
    }
  }
  
  // Traduire les erreurs Firebase
  getErrorMessage(code) {
    const messages = {
      'auth/user-not-found': 'Aucun compte trouvé avec cet email',
      'auth/wrong-password': 'Mot de passe incorrect',
      'auth/email-already-in-use': 'Cet email est déjà utilisé',
      'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères',
      'auth/invalid-email': 'Email invalide',
      'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard',
      'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion',
      'auth/popup-closed-by-user': 'Fenêtre de connexion fermée',
      'auth/cancelled-popup-request': 'Connexion annulée',
      'auth/popup-blocked': 'La popup a été bloquée par le navigateur'
    };
    return messages[code] || 'Une erreur est survenue. Veuillez réessayer.';
  }
  
  // Déconnexion
  async logout() {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('❌ Erreur déconnexion:', error);
    }
  }
  
  // Obtenir l'utilisateur courant
  getCurrentUser() {
    return this.currentUser;
  }
  
  // Vérifier si l'utilisateur est connecté
  isAuthenticated() {
    return !!this.currentUser;
  }

  showToast(message, type = 'success') {
    const toast = document.createElement('div');
    const bg = type === 'error'
      ? '#7F1D1D'
      : type === 'info'
        ? '#1F2937'
        : '#14532D';

    toast.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 1rem;
      transform: translateX(-50%) translateY(20px);
      background: ${bg};
      color: #F8F5EF;
      padding: 0.8rem 1rem;
      border-radius: 0.75rem;
      border: 1px solid rgba(255,255,255,0.2);
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      z-index: 1000001;
      font-size: 0.9rem;
      max-width: min(92vw, 460px);
      width: max-content;
      opacity: 0;
      transition: opacity 0.22s ease, transform 0.22s ease;
      text-align: center;
      line-height: 1.35;
    `;
    toast.textContent = message;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(16px)';
      setTimeout(() => toast.remove(), 220);
    }, 2600);
  }
}

let authInstance = null;

export function getAuthManager(options = {}) {
  if (!authInstance) {
    authInstance = new AuthManager(options);
  }
  return authInstance;
}

export default AuthManager;
