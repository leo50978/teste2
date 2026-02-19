import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  getFirestore,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  getDocs,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyANkKGDkA-t8Ijce4SNwqNcL8ArP9jPVqE',
  authDomain: 'allin-f65df.firebaseapp.com',
  projectId: 'allin-f65df',
  storageBucket: 'allin-f65df.firebasestorage.app',
  messagingSenderId: '955152530266',
  appId: '1:955152530266:web:19952842f4559b10af9163'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export async function sendBroadcastNotification(payload = {}) {
  const docData = {
    title: String(payload.title || 'Nouvelle notification'),
    body: String(payload.body || ''),
    type: String(payload.type || 'custom'),
    target: payload.target === 'user' ? 'user' : 'all',
    targetUid: payload.targetUid || null,
    url: payload.url || '/',
    createdBy: payload.createdBy || 'dashboard',
    createdAt: new Date().toISOString()
  };
  return addDoc(collection(db, 'notificationBroadcasts'), docData);
}

export class NotificationComponent {
  constructor(options = {}) {
    this.options = {
      mode: 'client', // client | dashboard
      appName: 'Vitch Studio',
      defaultUrl: '/',
      enabledStorageKey: null,
      listenDashboardOrders: true,
      ...options
    };
    this.unsubscribers = [];
    this.swRegistration = null;
    this.currentUser = null;
    this.currentClientId = null;
    this.lastOrderStatus = new Map();
    this.seenBroadcastIds = new Set();
    this.seenProductIds = new Set();
    this.isOrderInitDone = false;
    this.isProductInitDone = false;
    this.isBroadcastInitDone = false;
    this.isDashboardOrdersInitDone = false;
    this.seenDashboardOrderIds = new Set();
  }

  async init() {
    this.loadSeenState();
    await this.registerServiceWorker();
    this.listenAuth();
    if (this.options.mode === 'dashboard' && this.options.listenDashboardOrders) {
      this.listenNewOrdersForDashboard();
    } else {
      this.listenNewProducts();
      this.listenBroadcasts();
    }
  }

  destroy() {
    this.unsubscribers.forEach((u) => {
      try { u(); } catch (_) {}
    });
    this.unsubscribers = [];
  }

  async requestPermission() {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission !== 'default') return Notification.permission;
    return Notification.requestPermission();
  }

  async notify(title, body, data = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!this.isEnabled()) return;

    const payload = {
      body: String(body || ''),
      icon: './logo.png',
      badge: './logo.png',
      tag: data.tag || undefined,
      data: {
        url: data.url || this.options.defaultUrl || '/',
        ...data
      }
    };

    if (this.swRegistration) {
      await this.swRegistration.showNotification(String(title || this.options.appName), payload);
    } else {
      new Notification(String(title || this.options.appName), payload);
    }
  }

  isEnabled() {
    if (!this.options.enabledStorageKey) return true;
    return localStorage.getItem(this.options.enabledStorageKey) === '1';
  }

  setEnabled(enabled) {
    if (!this.options.enabledStorageKey) return;
    localStorage.setItem(this.options.enabledStorageKey, enabled ? '1' : '0');
  }

  loadSeenState() {
    try {
      const rawB = localStorage.getItem('veltrixa_seen_broadcasts');
      const rawP = localStorage.getItem('veltrixa_seen_products');
      const listB = rawB ? JSON.parse(rawB) : [];
      const listP = rawP ? JSON.parse(rawP) : [];
      this.seenBroadcastIds = new Set(Array.isArray(listB) ? listB.map(String) : []);
      this.seenProductIds = new Set(Array.isArray(listP) ? listP.map(String) : []);
    } catch (_) {}
  }

  saveSeenState() {
    try {
      localStorage.setItem('veltrixa_seen_broadcasts', JSON.stringify(Array.from(this.seenBroadcastIds).slice(-300)));
      localStorage.setItem('veltrixa_seen_products', JSON.stringify(Array.from(this.seenProductIds).slice(-300)));
    } catch (_) {}
  }

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.swRegistration = await navigator.serviceWorker.register('./notification-sw.js');
    } catch (error) {
      console.warn('⚠️ Service worker notifications non disponible:', error);
    }
  }

  shouldShowOrderPrompt() {
    if (this.options.mode !== 'client') return false;
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return false;
    if (localStorage.getItem('veltrixa_order_notif_enabled') === '1') return false;
    if (localStorage.getItem('veltrixa_order_notif_never') === '1') return false;
    return true;
  }

  async promptOrderNotificationChoice() {
    if (!this.shouldShowOrderPrompt()) return;
    if (document.getElementById('veltrixa-order-notif-modal')) return;

    const overlay = document.createElement('div');
    overlay.id = 'veltrixa-order-notif-modal';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:1000000',
      'background:rgba(0,0,0,.45)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'padding:16px'
    ].join(';');
    overlay.innerHTML = `
      <div style="background:#fff;max-width:420px;width:100%;border-radius:14px;padding:18px;border:1px solid #E2E8F0;font-family:Manrope,sans-serif;">
        <h3 style="margin:0 0 10px 0;font-size:18px;color:#1F1E1C;">Recevoir les notifications de commande ?</h3>
        <p style="margin:0 0 14px 0;color:#4A4A4A;font-size:14px;">
          Voulez-vous recevoir une notification quand votre commande est approuvée ou rejetée ?
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
          <button id="order-notif-never" style="padding:8px 10px;border:1px solid #CBD5E1;background:#fff;border-radius:999px;cursor:pointer;">Non et ne plus montrer</button>
          <button id="order-notif-no" style="padding:8px 10px;border:1px solid #CBD5E1;background:#fff;border-radius:999px;cursor:pointer;">Non</button>
          <button id="order-notif-yes" style="padding:8px 10px;border:1px solid #C6A75E;background:#C6A75E;color:#1F1E1C;border-radius:999px;cursor:pointer;font-weight:600;">Oui</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();

    overlay.querySelector('#order-notif-no')?.addEventListener('click', closeModal);
    overlay.querySelector('#order-notif-never')?.addEventListener('click', () => {
      localStorage.setItem('veltrixa_order_notif_never', '1');
      closeModal();
    });
    overlay.querySelector('#order-notif-yes')?.addEventListener('click', async () => {
      const permission = await this.requestPermission();
      if (permission === 'granted') {
        localStorage.setItem('veltrixa_order_notif_enabled', '1');
        localStorage.setItem('veltrixa_order_notif_never', '1');
        await this.notify('Notifications activées', 'Vous recevrez les mises à jour de commande.', { url: this.options.defaultUrl, tag: 'notif_enabled' });
      }
      closeModal();
    });
  }

  listenAuth() {
    const unsub = onAuthStateChanged(auth, async (user) => {
      this.currentUser = user;
      this.currentClientId = null;
      this.lastOrderStatus.clear();
      this.isOrderInitDone = false;
      this.unsubscribers = this.unsubscribers.filter((u) => u !== this.ordersUnsub);
      if (this.ordersUnsub) {
        try { this.ordersUnsub(); } catch (_) {}
        this.ordersUnsub = null;
      }
      if (!user || this.options.mode !== 'client') return;
      await this.consumePendingUserBroadcasts(user.uid);
      this.currentClientId = await this.findClientIdByUid(user.uid);
      if (this.currentClientId) this.listenOwnOrders(this.currentClientId);
    });
    this.unsubscribers.push(unsub);
  }

  async consumePendingUserBroadcasts(uid) {
    try {
      const q = query(collection(db, 'notificationBroadcasts'), orderBy('createdAt', 'desc'), limit(40));
      const snapshot = await getDocs(q);
      snapshot.docs.forEach((docSnap) => {
        const id = docSnap.id;
        if (this.seenBroadcastIds.has(id)) return;
        const data = docSnap.data() || {};
        if (data.target === 'user' && data.targetUid === uid) {
          this.seenBroadcastIds.add(id);
          this.notify(data.title || 'Notification', data.body || '', { url: data.url || this.options.defaultUrl, tag: `broadcast_${id}` });
        }
      });
      this.saveSeenState();
    } catch (error) {
      console.error('❌ Erreur rattrapage notifications user:', error);
    }
  }

  async findClientIdByUid(uid) {
    try {
      const q = query(collection(db, 'clients'), where('uid', '==', uid), limit(1));
      const snapshot = await getDocs(q);
      if (snapshot.empty) return null;
      return snapshot.docs[0].id;
    } catch (error) {
      console.error('❌ Erreur client notification:', error);
      return null;
    }
  }

  listenOwnOrders(clientId) {
    const q = query(collection(db, 'clients', clientId, 'orders'), orderBy('createdAt', 'desc'));
    this.ordersUnsub = onSnapshot(q, (snapshot) => {
      if (!this.isOrderInitDone) {
        snapshot.docs.forEach((d) => this.lastOrderStatus.set(d.id, d.data()?.status || 'pending'));
        this.isOrderInitDone = true;
        return;
      }
      snapshot.docChanges().forEach((change) => {
        const id = change.doc.id;
        const data = change.doc.data() || {};
        const nextStatus = data.status || 'pending';
        const prevStatus = this.lastOrderStatus.get(id);
        this.lastOrderStatus.set(id, nextStatus);
        if (!prevStatus || prevStatus === nextStatus) return;

        if (nextStatus === 'approved') {
          this.notify('Commande approuvée', `Votre commande ${data.uniqueCode || id} est approuvée.`, { url: this.options.defaultUrl, tag: `order_${id}` });
        } else if (nextStatus === 'rejected') {
          this.notify('Commande rejetée', `Votre commande ${data.uniqueCode || id} a été rejetée.`, { url: this.options.defaultUrl, tag: `order_${id}` });
        } else if (nextStatus === 'review') {
          this.notify('Commande en examen', `Votre commande ${data.uniqueCode || id} est en cours de vérification.`, { url: this.options.defaultUrl, tag: `order_${id}` });
        }
      });
    });
    this.unsubscribers.push(this.ordersUnsub);
  }

  listenBroadcasts() {
    const q = query(collection(db, 'notificationBroadcasts'), orderBy('createdAt', 'desc'), limit(50));
    const unsub = onSnapshot(q, (snapshot) => {
      if (!this.isBroadcastInitDone) {
        snapshot.docs.forEach((d) => this.seenBroadcastIds.add(d.id));
        this.isBroadcastInitDone = true;
        this.saveSeenState();
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const id = change.doc.id;
        if (this.seenBroadcastIds.has(id)) return;
        const data = change.doc.data() || {};
        if (data.target === 'user' && !this.currentUser) return;
        const allowed = data.target === 'all' || (this.currentUser && data.targetUid && data.targetUid === this.currentUser.uid);
        if (!allowed) {
          this.seenBroadcastIds.add(id);
          this.saveSeenState();
          return;
        }
        this.seenBroadcastIds.add(id);
        this.saveSeenState();
        this.notify(data.title || 'Notification', data.body || '', { url: data.url || this.options.defaultUrl, tag: `broadcast_${id}` });
      });
    });
    this.unsubscribers.push(unsub);
  }

  listenNewProducts() {
    const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, (snapshot) => {
      if (!this.isProductInitDone) {
        snapshot.docs.forEach((d) => this.seenProductIds.add(d.id));
        this.isProductInitDone = true;
        this.saveSeenState();
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const id = change.doc.id;
        if (this.seenProductIds.has(id)) return;
        const data = change.doc.data() || {};
        this.seenProductIds.add(id);
        this.saveSeenState();
        this.notify('Nouveau produit', `${data.name || 'Un nouveau produit'} est disponible.`, { url: this.options.defaultUrl, tag: `product_${id}` });
      });
    });
    this.unsubscribers.push(unsub);
  }

  listenNewOrdersForDashboard() {
    const q = query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(30));
    const unsub = onSnapshot(q, (snapshot) => {
      if (!this.isDashboardOrdersInitDone) {
        snapshot.docs.forEach((d) => this.seenDashboardOrderIds.add(d.id));
        this.isDashboardOrdersInitDone = true;
        return;
      }
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const id = change.doc.id;
        if (this.seenDashboardOrderIds.has(id)) return;
        const data = change.doc.data() || {};
        this.seenDashboardOrderIds.add(id);
        this.notify('Nouvelle commande', `Nouvelle commande reçue ${data.uniqueCode || id}.`, { url: this.options.defaultUrl, tag: `admin_order_${id}` });
      });
    });
    this.unsubscribers.push(unsub);
  }
}
