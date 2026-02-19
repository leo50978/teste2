// ============= COMPOSANT COMMENTAIRES - AVEC ANIMATIONS CRÉATIVES =============
import theme from './theme-root.js';
import anime from 'https://cdn.skypack.dev/animejs@3.2.1';

class CommentaireComponent {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    
    if (!this.container) {
      console.error(`❌ Commentaire: Container #${containerId} non trouvé`);
      return;
    }
    
    this.options = {
      ...options
    };
    
    this.theme = theme;
    this.observer = null;
    this.isVisible = false;
    this.animationPlayed = false;
    
    // Messages prédéfinis (100 messages)
    this.presetMessages = [
      "Excellente qualité, vraiment au-delà de mes attentes. Le service est impeccable et le rapport qualité-prix est excellent.",
      "Service irréprochable, je recommande vivement cette maison qui allie tradition et modernité avec brio.",
      "Un véritable plaisir de découvrir cette enseigne. Le professionnalisme et la qualité sont au rendez-vous.",
      "Rien à redire, tout était parfait de la commande à la livraison. Une expérience client exceptionnelle.",
      "Parfait du début à la fin, je suis pleinement satisfait de mon achat et du service client réactif.",
      "Je recommande vivement cette adresse, une valeur sûre dans un monde où la qualité se fait rare.",
      "Une expérience unique, digne des plus grandes maisons. Le savoir-faire est clairement au rendez-vous.",
      "Savoir-faire exceptionnel, on sent l'expertise et la passion dans chaque détail. Bravo à toute l'équipe.",
      "Très professionnel, à l'écoute et réactif. Une entreprise qui mérite vraiment d'être connue.",
      "Un grand merci pour votre sérieux et votre professionnalisme. Je reviendrai sans hésiter.",
      "Au-delà de mes attentes, je ne pensais pas trouver une telle qualité. Félicitations à toute l'équipe.",
      "Une référence dans son domaine, je ne peux que recommander les yeux fermés.",
      "Qualité supérieure, vraiment impressionné par le soin apporté à chaque détail.",
      "Livraison rapide et soignée, le produit était parfaitement emballé et conforme à la description.",
      "Emballage soigné, produit intact et livraison dans les délais. Parfait.",
      "Produits authentiques et de grande qualité, fidèles à la réputation de la maison.",
      "Service client réactif et agréable, ils ont su répondre à toutes mes questions.",
      "Je suis conquis, je ne passerai plus que par eux désormais. Une belle découverte.",
      "À la hauteur de ma réputation, cette maison tient toutes ses promesses.",
      "Exactement ce que je cherchais, je suis ravi de mon achat et du service.",
      "Rapport qualité-prix imbattable, je ne pensais pas trouver aussi bien à ce prix.",
      "Finition parfaite, on voit que chaque détail a été pensé avec soin.",
      "Très satisfait de mon achat, je recommanderai autour de moi sans hésiter.",
      "Une belle découverte que je ne manquerai pas de partager avec mes proches.",
      "Je reviendrai sans hésiter, cette première expérience m'a pleinement convaincu.",
      "Merci pour votre sérieux et votre professionnalisme, c'est trop rare de nos jours.",
      "Un travail d'orfèvre, chaque détail est parfaitement maîtrisé. Chapeau bas.",
      "Du grand art, cette maison est vraiment une référence dans son domaine.",
      "Chapeau bas, vous méritez amplement votre réputation d'excellence.",
      "Une maison de confiance, je recommande les yeux fermés à tous mes proches.",
      "Des années d'avance sur la concurrence, vous êtes clairement les meilleurs.",
      "Le luxe discret et raffiné, exactement ce que je recherchais. Merci.",
      "L'élégance à la française, un savoir-faire rare et précieux à préserver.",
      "Un savoir-faire rare, on sent l'expertise et la passion à chaque étape.",
      "La perfection incarnée, je suis bluffé par la qualité exceptionnelle.",
      "Rien à redire, tout était parfait du début à la fin. Une expérience client exemplaire.",
      "Impeccable, du début à la fin. Je recommande vivement cette adresse.",
      "Sans faute, tout était parfait. Une maison vraiment digne de confiance.",
      "Remarquable, vraiment remarquable. Je ne pensais pas trouver une telle qualité.",
      "Une valeur sûre, on peut commander les yeux fermés, vous ne serez pas déçu.",
      "Je ne peux que recommander, cette maison est vraiment au top.",
      "Exemplaire, c'est le mot qui me vient à l'esprit. Bravo à toute l'équipe.",
      "Du travail bien fait, ça change de ce qu'on voit habituellement. Merci.",
      "Un service haut de gamme, vraiment digne des plus grandes maisons.",
      "À la hauteur, vous avez su répondre à toutes mes attentes. Merci.",
      "Les plus belles années, une maison qui traverse le temps avec élégance.",
      "Un gage de qualité, on peut commander en toute confiance les yeux fermés.",
      "La référence absolue dans le domaine, bravo pour ce travail exceptionnel.",
      "Toujours aussi satisfait après toutes ces années, vous êtes les meilleurs.",
      "Merci pour ce moment, une expérience client vraiment unique et précieuse.",
      "Une réussite totale, je suis bluffé par la qualité exceptionnelle.",
      "Bravo à toute l'équipe, vous faites un travail remarquable. Continuez ainsi.",
      "Un grand professionnalisme, à l'écoute et réactif. Merci pour tout.",
      "Excellent suivi de commande, je suis ravi de cette première expérience.",
      "Commande parfaite, rien à redire. Je reviendrai sans hésiter.",
      "Délais respectés, produit conforme, service impeccable. Que demander de plus ?",
      "Produit conforme à la description, livraison rapide, service parfait.",
      "Service après-vente réactif et efficace, ils ont su résoudre mon problème rapidement.",
      "Je suis client depuis des années et toujours aussi satisfait. Une valeur sûre.",
      "Une adresse à garder précieusement, on ne trouve plus ce genre de qualité.",
      "Je recommande les yeux fermés, cette maison est vraiment exceptionnelle.",
      "C'est parfait, vraiment parfait. Rien à redire, merci pour tout.",
      "Un sans-faute, du début à la fin. Bravo à toute l'équipe.",
      "Fidèle au poste depuis toutes ces années, vous êtes vraiment les meilleurs.",
      "La qualité avant tout, c'est ce qui vous caractérise. Merci.",
      "Du sur-mesure, exactement ce que je recherchais. Un service personnalisé.",
      "Un accompagnement personnalisé, ils ont su répondre à mes besoins spécifiques.",
      "Des experts dans leur domaine, on sent la passion et le savoir-faire.",
      "Je ne suis jamais déçu, vous êtes toujours à la hauteur de mes attentes.",
      "Merci pour votre accueil chaleureux et votre professionnalisme.",
      "Très bonne expérience, je reviendrai sans hésiter. Merci à toute l'équipe.",
      "Un moment privilégié, cette maison sait recevoir ses clients avec élégance.",
      "L'excellence à la française, vous en êtes les dignes représentants.",
      "Du grand luxe, une expérience vraiment unique et mémorable.",
      "Une maison d'exception, je ne peux que recommander chaudement.",
      "Le raffinement absolu, chaque détail est parfaitement maîtrisé.",
      "Un instant rare, cette qualité devient difficile à trouver de nos jours.",
      "La perfection incarnée, je suis bluffé par tant de talent.",
      "Un service d'antan, comme on n'en fait plus. Merci pour cette parenthèse.",
      "Le temps suspendu, une expérience hors du temps vraiment précieuse.",
      "Une parenthèse enchantée, merci pour ce moment de grâce.",
      "Du jamais vu, une qualité exceptionnelle vraiment rare.",
      "Une merveille, absolument parfait du début à la fin.",
      "Absolument divin, je suis aux anges. Merci pour cette merveille.",
      "Rien de tel ailleurs, vous êtes vraiment uniques en votre genre.",
      "Une pure merveille, je ne regrette pas mon choix une seconde."
    ];
    
    // Tableau des commentaires
    this.comments = [];
    this.uniqueId = 'comment_' + Math.random().toString(36).substr(2, 9);
    this.scrollInterval = null;
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe(() => {
      this.render(); // Re-rendre quand le thème change
    });
    
    this.init();
  }
  
  init() {
    this.initializeComments();
    this.render();
    this.setupScrollAnimation();
    this.startScrolling();
    this.attachEvents();
  }
  
  initializeComments() {
    const shuffled = [...this.presetMessages].sort(() => 0.5 - Math.random());
    for (let i = 0; i < 3; i++) {
      this.comments.push({
        id: Date.now() + i,
        text: shuffled[i],
        time: this.getRandomTime(),
        type: 'preset'
      });
    }
  }
  
  getRandomTime() {
    const types = [
      { text: "il y a 30 s", min: 0.5, max: 0.5 },
      { text: "il y a 1 min", min: 1, max: 1 },
      { text: "il y a 2 min", min: 2, max: 2 },
      { text: "il y a 5 min", min: 5, max: 5 },
      { text: "il y a 10 min", min: 10, max: 10 },
      { text: "il y a 15 min", min: 15, max: 15 },
      { text: "il y a 30 min", min: 30, max: 30 },
      { text: "il y a 1 h", min: 60, max: 60 },
      { text: "il y a 2 h", min: 120, max: 120 },
      { text: "il y a 3 h", min: 180, max: 180 },
      { text: "il y a 5 h", min: 300, max: 300 },
      { text: "il y a 12 h", min: 720, max: 720 },
      { text: "hier", min: 1440, max: 1440 },
      { text: "il y a 2 j", min: 2880, max: 2880 }
    ];
    
    const randomIndex = Math.floor(Math.random() * types.length);
    return types[randomIndex].text;
  }
  
  // ============================================
  // ANIMATION AU SCROLL AVEC ANIME.JS
  // ============================================
  setupScrollAnimation() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.isVisible = true;
          this.animateEntrance();
        } else {
          this.isVisible = false;
          this.animationPlayed = false; // Reset pour la prochaine apparition
        }
      });
    }, {
      threshold: 0.2,
      rootMargin: "0px"
    });
    
    const container = this.container.querySelector(`.comment-oldmoney-${this.uniqueId}`);
    if (container) {
      this.observer.observe(container);
    }
  }
  
  animateEntrance() {
    if (this.animationPlayed) return;
    
    const container = this.container.querySelector(`.comment-oldmoney-${this.uniqueId}`);
    const title = container.querySelector(`.comment-label-${this.uniqueId}`);
    const inputWrapper = container.querySelector(`.comment-input-wrapper-${this.uniqueId}`);
    const cards = container.querySelectorAll(`.comment-card-${this.uniqueId}`);
    
    // Animation d'entrée sobre et fluide
    anime.timeline({
      easing: 'easeOutCubic',
      complete: () => {
        this.animationPlayed = true;
      }
    })
    .add({
      targets: title,
      translateY: [14, 0],
      opacity: [0, 1],
      duration: 420,
    })
    .add({
      targets: cards,
      translateY: [16, 0],
      opacity: [0, 1],
      delay: anime.stagger(80, {start: 80}),
      duration: 460,
    }, '-=400')
    .add({
      targets: inputWrapper,
      translateY: [14, 0],
      opacity: [0, 1],
      duration: 420
    }, '-=200');
  }
  
  // Animation pour les nouveaux messages
  animateNewMessage(card) {
    anime({
      targets: card,
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 380,
      easing: 'easeOutCubic'
    });
  }
  
  // Animation pour les commentaires utilisateur
  animateUserMessage(card) {
    anime({
      targets: card,
      opacity: [0, 1],
      translateY: [12, 0],
      duration: 420,
      easing: 'easeOutCubic'
    });
  }
  
  // Animation du bouton
  animateButton(button) {
    anime({
      targets: button,
      scale: [1, 0.95, 1],
      rotate: ['0deg', '-2deg', '2deg', '0deg'],
      backgroundColor: [
        {value: this.theme.getColors()?.background?.button, duration: 100},
        {value: this.theme.getColors()?.text?.subtitle, duration: 200},
        {value: this.theme.getColors()?.background?.button, duration: 200}
      ],
      duration: 600,
      easing: 'easeInOutQuad'
    });
  }
  
  // Animation du scroll automatique
  animateScroll(list) {
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }
  
  render() {
    const colors = this.theme.getColors();
    const fonts = this.theme.getFonts();
    const typography = this.theme.getTypography();
    
    // Couleurs selon la structure du thème
    const primaryColor = colors?.text?.title || '#1F1E1C';
    const secondaryColor = colors?.text?.subtitle || '#C6A75E';
    const textColor = colors?.text?.body || '#2C3E50';
    const lightBg = colors?.background?.card || '#F5F1E8';
    const borderColor = colors?.background?.card ? `${colors.background.card}80` : '#d4c8bc';
    const buttonBg = colors?.background?.button || '#1F1E1C';
    const buttonText = colors?.text?.button || '#FFFFFF';
    
    // Polices
    const primaryFont = typography?.family || fonts?.primary || "'Cormorant Garamond', serif";
    const secondaryFont = fonts?.secondary || "'Manrope', sans-serif";
    
    // Style CSS avec les animations
    const style = document.createElement('style');
    style.textContent = `
      .comment-oldmoney-${this.uniqueId} {
        font-family: ${primaryFont}, 'Times New Roman', serif;
        width: 100%;
        max-width: 800px;
        margin: 0 auto;
        background: transparent;
        transform-origin: center;
        overflow: hidden;
      }
      
      .comment-list-${this.uniqueId} {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 2rem;
        width: 100%;
        max-height: 500px;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: 0;
        scroll-behavior: smooth;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      
      .comment-list-${this.uniqueId}::-webkit-scrollbar {
        display: none;
      }
      
      .comment-card-${this.uniqueId} {
        background: white;
        border: 1px solid ${borderColor};
        padding: 1.25rem;
        transition: all 0.3s ease;
        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        display: flex;
        flex-direction: column;
        transform-origin: center;
        will-change: transform, opacity, box-shadow;
      }
      
      .comment-card-${this.uniqueId}:hover {
        box-shadow: 0 6px 16px rgba(0,0,0,0.06);
        border-color: ${secondaryColor};
      }
      
      .comment-card-content-${this.uniqueId} {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        height: 100%;
      }
      
      .comment-card-text-${this.uniqueId} {
        font-size: 1rem;
        line-height: 1.5;
        color: ${textColor};
        font-style: italic;
        quotes: "«" "»";
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        max-height: 4.5rem;
        position: relative;
      }
      
      .comment-card-text-${this.uniqueId}::before {
        content: "« ";
        color: ${secondaryColor};
        font-size: 1.2rem;
        opacity: 0.7;
      }
      
      .comment-card-text-${this.uniqueId}::after {
        content: " »";
        color: ${secondaryColor};
        font-size: 1.2rem;
        opacity: 0.7;
      }
      
      .comment-card-time-${this.uniqueId} {
        font-size: 0.75rem;
        color: ${secondaryColor};
        text-align: right;
        font-family: ${secondaryFont};
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 0.5rem;
        opacity: 0.8;
        transition: opacity 0.3s ease;
      }
      
      .comment-card-${this.uniqueId}:hover .comment-card-time-${this.uniqueId} {
        opacity: 1;
      }
      
      .comment-card-time-${this.uniqueId}.just-now {
        color: ${primaryColor};
        font-weight: 600;
      }
      
      .comment-form-${this.uniqueId} {
        width: 100%;
        border-top: 1px solid ${borderColor};
        padding-top: 2rem;
        margin-top: 1rem;
        transform-origin: top;
      }
      
      .comment-label-${this.uniqueId} {
        font-family: ${primaryFont};
        font-size: 1.2rem;
        color: ${primaryColor};
        margin-bottom: 1rem;
        display: block;
        font-weight: 500;
        letter-spacing: 0.5px;
        transform-origin: left;
      }
      
      .comment-input-wrapper-${this.uniqueId} {
        display: flex;
        gap: 0.5rem;
        width: 100%;
        transform-origin: top;
      }
      
      .comment-input-${this.uniqueId} {
        flex: 1;
        padding: 0.9rem 1.2rem;
        border: 1px solid ${borderColor};
        background: white;
        font-family: ${secondaryFont};
        font-size: 0.95rem;
        color: ${textColor};
        transition: all 0.2s ease;
        outline: none;
      }
      
      .comment-input-${this.uniqueId}:focus {
        border-color: ${primaryColor};
        background: ${lightBg};
        box-shadow: 0 2px 10px rgba(0,0,0,0.05);
      }
      
      .comment-input-${this.uniqueId}::placeholder {
        color: ${borderColor};
        font-style: italic;
        font-size: 0.9rem;
      }
      
      .comment-button-${this.uniqueId} {
        padding: 0.9rem 2rem;
        background: ${buttonBg};
        color: ${buttonText};
        border: none;
        font-family: ${secondaryFont};
        font-size: 0.9rem;
        font-weight: 500;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
        border: 1px solid ${buttonBg};
        position: relative;
        overflow: hidden;
      }
      
      .comment-button-${this.uniqueId}::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 0;
        height: 0;
        border-radius: 50%;
        background: rgba(255,255,255,0.3);
        transform: translate(-50%, -50%);
        transition: width 0.6s, height 0.6s;
      }
      
      .comment-button-${this.uniqueId}:hover::after {
        width: 300px;
        height: 300px;
      }
      
      .comment-button-${this.uniqueId}:hover {
        background: transparent;
        color: ${buttonBg};
      }
      
      .comment-button-${this.uniqueId}:active {
        transform: scale(0.95);
      }
      
      .new-message-indicator-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${secondaryColor};
        margin-top: 0.5rem;
        text-align: right;
        font-style: italic;
        animation: pulse 2s infinite;
      }
      
      @keyframes pulse {
        0% { opacity: 0.6; }
        50% { opacity: 1; }
        100% { opacity: 0.6; }
      }
      
      @media (max-width: 640px) {
        .comment-list-${this.uniqueId} {
          max-height: 400px;
        }
        
        .comment-card-${this.uniqueId} {
          padding: 1rem;
        }
        
        .comment-card-text-${this.uniqueId} {
          font-size: 0.9rem;
        }
        
        .comment-input-wrapper-${this.uniqueId} {
          flex-direction: column;
        }
        
        .comment-button-${this.uniqueId} {
          width: 100%;
        }
      }
    `;
    
    // Nettoyer les anciens styles
    const oldStyle = document.getElementById(`comment-styles-${this.uniqueId}`);
    if (oldStyle) oldStyle.remove();
    
    style.id = `comment-styles-${this.uniqueId}`;
    document.head.appendChild(style);
    
    // HTML
    this.container.innerHTML = `
      <div class="comment-oldmoney-${this.uniqueId}">
        <div class="comment-list-${this.uniqueId}" id="commentList-${this.uniqueId}">
          ${this.renderCommentList()}
        </div>
        
        <div class="comment-form-${this.uniqueId}">
          <label class="comment-label-${this.uniqueId}">Laissez un message vous aussi</label>
          <div class="comment-input-wrapper-${this.uniqueId}">
            <input type="text" 
                   class="comment-input-${this.uniqueId}" 
                   placeholder="Votre message..."
                   id="commentInput-${this.uniqueId}">
            <button class="comment-button-${this.uniqueId}" id="sendButton-${this.uniqueId}">
              Envoyer
            </button>
          </div>
        </div>
        
        <div class="new-message-indicator-${this.uniqueId}" id="indicator-${this.uniqueId}" style="display: none;">
          <i class="fas fa-comment"></i> Nouveau message ajouté
        </div>
      </div>
    `;
    
    // Vérifier la visibilité initiale
    setTimeout(() => {
      const rect = this.container.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        this.animateEntrance();
      }
    }, 100);
  }
  
  renderCommentList() {
    const displayComments = this.comments.slice(-3).reverse();
    
    return displayComments.map(comment => {
      const timeClass = comment.time === "à l'instant" ? 'just-now' : '';
      
      return `
        <div class="comment-card-${this.uniqueId}" data-id="${comment.id}" data-type="${comment.type}">
          <div class="comment-card-content-${this.uniqueId}">
            <div class="comment-card-text-${this.uniqueId}">${comment.text}</div>
            <div class="comment-card-time-${this.uniqueId} ${timeClass}">${comment.time}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  startScrolling() {
    if (this.scrollInterval) clearInterval(this.scrollInterval);
    
    this.scrollInterval = setInterval(() => {
      const randomMessage = this.presetMessages[Math.floor(Math.random() * this.presetMessages.length)];
      
      const newComment = {
        id: Date.now(),
        text: randomMessage,
        time: this.getRandomTime(),
        type: 'preset'
      };
      
      this.comments.push(newComment);
      
      if (this.comments.length > 10) {
        this.comments.shift();
      }
      
      this.updateCommentList(true); // true pour animation spéciale
      
      const indicator = document.getElementById(`indicator-${this.uniqueId}`);
      if (indicator) {
        indicator.style.display = 'block';
        indicator.innerHTML = '<i class="fas fa-sync"></i> Nouveau message';
        setTimeout(() => {
          indicator.style.display = 'none';
        }, 2000);
      }
      
    }, 6000);
  }
  
  updateCommentList(isAutoMessage = false) {
    const list = document.getElementById(`commentList-${this.uniqueId}`);
    if (!list) return;
    
    list.innerHTML = this.renderCommentList();
    
    const cards = list.querySelectorAll(`.comment-card-${this.uniqueId}`);
    if (cards.length > 0) {
      const newestCard = cards[0];
      
      if (isAutoMessage) {
        this.animateNewMessage(newestCard);
      } else {
        this.animateUserMessage(newestCard);
      }
    }
    
    this.animateScroll(list);
  }
  
  addUserComment(text) {
    if (!text.trim()) return;
    
    const newComment = {
      id: Date.now(),
      text: text.trim(),
      time: "à l'instant",
      type: 'user'
    };
    
    this.comments.push(newComment);
    
    if (this.comments.length > 10) {
      this.comments.shift();
    }
    
    this.updateCommentList(false);
    
    const input = document.getElementById(`commentInput-${this.uniqueId}`);
    if (input) input.value = '';
    
    const button = document.getElementById(`sendButton-${this.uniqueId}`);
    if (button) {
      this.animateButton(button);
    }
    
    const indicator = document.getElementById(`indicator-${this.uniqueId}`);
    if (indicator) {
      indicator.style.display = 'block';
      indicator.innerHTML = '<i class="fas fa-check-circle" style="color: #4CAF50;"></i> Votre message a été ajouté';
      indicator.style.color = '#4CAF50';
      setTimeout(() => {
        indicator.style.display = 'none';
      }, 3000);
    }
    
    const list = document.getElementById(`commentList-${this.uniqueId}`);
    if (list) {
      setTimeout(() => {
        this.animateScroll(list);
      }, 100);
    }
  }
  
  attachEvents() {
    const sendButton = document.getElementById(`sendButton-${this.uniqueId}`);
    const input = document.getElementById(`commentInput-${this.uniqueId}`);
    
    if (sendButton) {
      sendButton.addEventListener('click', () => this.addUserComment(input.value));
    }
    
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.addUserComment(input.value);
        }
      });
    }
  }
  
  destroy() {
    if (this.scrollInterval) clearInterval(this.scrollInterval);
    if (this.unsubscribeTheme) this.unsubscribeTheme();
    if (this.observer) this.observer.disconnect();
    this.container.innerHTML = '';
  }
}

export default CommentaireComponent;
