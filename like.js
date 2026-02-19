// ============= LIKE COMPONENT - FIREBASE + AUTH =============
import { db } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class SierraLike {
  constructor(options = {}) {
    this.options = {
      collectionName: 'productLikes',
      productsCollection: 'products',
      ...options
    };

    this.auth = null;
    this.currentUser = null;
    this.likes = new Map();
    this.unsubscribeLikes = null;
    this.uniqueId = 'like_' + Math.random().toString(36).slice(2, 11);

    this.init();
  }

  init() {
    try {
      this.auth = getAuthManager({
        onAuthChange: (user) => this.handleAuthChange(user)
      });
      this.currentUser = this.auth?.getCurrentUser() || null;
      this.handleAuthChange(this.currentUser);
    } catch (error) {
      console.error('❌ Like: erreur initialisation auth', error);
    }

    document.addEventListener('authChanged', (e) => {
      this.handleAuthChange(e?.detail?.user || null);
    });
  }

  handleAuthChange(user) {
    this.currentUser = user || null;

    if (this.unsubscribeLikes) {
      this.unsubscribeLikes();
      this.unsubscribeLikes = null;
    }

    this.likes.clear();

    if (!user?.uid) {
      this.emitUpdate();
      return;
    }

    const likesRef = collection(db, this.options.collectionName);
    const q = query(likesRef, where('userId', '==', user.uid));

    this.unsubscribeLikes = onSnapshot(q, (snapshot) => {
      this.likes.clear();
      snapshot.forEach((snap) => {
        const data = snap.data() || {};
        const productId = String(data.productId || '');
        if (!productId) return;
        this.likes.set(productId, {
          id: snap.id,
          productId,
          name: data.productName || 'Produit',
          image: data.productImage || '',
          price: data.productPrice || '',
          likedAt: data.likedAt || null,
          userId: data.userId || '',
          userName: data.userName || '',
          userEmail: data.userEmail || ''
        });
      });
      this.emitUpdate();
    }, (error) => {
      console.error('❌ Like: erreur écoute likes', error);
    });
  }

  isAuthenticated() {
    return !!this.currentUser;
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isLiked(productId) {
    return this.likes.has(String(productId));
  }

  getLikeDocId(productId, userId = this.currentUser?.uid) {
    return `${String(userId || '').trim()}_${String(productId || '').trim()}`;
  }

  getLikedProducts() {
    return Array.from(this.likes.values()).sort((a, b) => {
      const aTime = this.toMillis(a.likedAt);
      const bTime = this.toMillis(b.likedAt);
      return bTime - aTime;
    });
  }

  toMillis(dateLike) {
    if (!dateLike) return 0;
    if (typeof dateLike?.toMillis === 'function') return dateLike.toMillis();
    const ts = new Date(dateLike).getTime();
    return Number.isFinite(ts) ? ts : 0;
  }

  async ensureProductMeta(productId, fallback = {}) {
    const meta = {
      name: fallback.name || 'Produit',
      image: fallback.image || '',
      price: fallback.price || '',
      ...fallback
    };

    if (meta.name && meta.image && meta.price) return meta;

    try {
      const productRef = doc(db, this.options.productsCollection, String(productId));
      const snap = await getDoc(productRef);
      if (snap.exists()) {
        const data = snap.data() || {};
        const image = Array.isArray(data.images) && data.images.length > 0 ? data.images[0] : '';
        return {
          name: meta.name || data.name || 'Produit',
          image: meta.image || image || '',
          price: meta.price || data.price || ''
        };
      }
    } catch (error) {
      console.warn('⚠️ Like: impossible de charger meta produit', error);
    }

    return meta;
  }

  async toggleLike(productId, meta = {}) {
    const pid = String(productId || '').trim();
    if (!pid) return { ok: false, reason: 'missing_product_id' };

    if (!this.currentUser?.uid) {
      if (this.auth) this.auth.openAuthModal('login');
      document.dispatchEvent(new CustomEvent('likeAuthRequired', {
        detail: { productId: pid }
      }));
      return { ok: false, reason: 'auth_required' };
    }

    const uid = this.currentUser.uid;
    const likeDocId = this.getLikeDocId(pid, uid);
    const likeRef = doc(db, this.options.collectionName, likeDocId);

    try {
      if (this.isLiked(pid)) {
        await deleteDoc(likeRef);
        return { ok: true, liked: false };
      }

      const resolvedMeta = await this.ensureProductMeta(pid, meta);
      await setDoc(likeRef, {
        productId: pid,
        userId: uid,
        userEmail: this.currentUser.email || '',
        userName: this.currentUser.displayName || '',
        productName: resolvedMeta.name || 'Produit',
        productImage: resolvedMeta.image || '',
        productPrice: resolvedMeta.price || '',
        likedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      return { ok: true, liked: true };
    } catch (error) {
      console.error('❌ Like: erreur toggle', error);
      return { ok: false, reason: 'write_failed', error };
    }
  }

  emitUpdate() {
    const likes = this.getLikedProducts();
    document.dispatchEvent(new CustomEvent('likesUpdated', {
      detail: {
        totalLikes: likes.length,
        likes,
        isAuthenticated: this.isAuthenticated(),
        userId: this.currentUser?.uid || null
      }
    }));
  }

  destroy() {
    if (this.unsubscribeLikes) {
      this.unsubscribeLikes();
      this.unsubscribeLikes = null;
    }
  }
}

let likeInstance = null;

export function getLikeManager(containerIdOrOptions = null, maybeOptions = {}) {
  const options = (containerIdOrOptions && typeof containerIdOrOptions === 'object')
    ? containerIdOrOptions
    : maybeOptions;
  if (!likeInstance) {
    likeInstance = new SierraLike(options);
  }
  return likeInstance;
}

export default SierraLike;
