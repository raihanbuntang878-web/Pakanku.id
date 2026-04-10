import React, { useState, useEffect } from 'react';
import { 
  Home, ShoppingCart, User as UserIcon, Search, 
  Star, ChevronLeft, Plus, Minus, Trash2, Package, 
  MapPin, Store, MessageSquare, Leaf, LogOut, Edit2, Check, X
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, signInWithCustomToken, signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, signOut, onAuthStateChanged 
} from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, getDoc, updateDoc, 
  deleteDoc, onSnapshot 
} from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'pakanku-app';

const categories = [
  { id: 'c1', name: 'Ayam', icon: '🐔' },
  { id: 'c2', name: 'Ikan', icon: '🐟' },
  { id: 'c3', name: 'Sapi', icon: '🐄' },
  { id: 'c4', name: 'Burung', icon: '🐦' },
  { id: 'c5', name: 'Kucing', icon: '🐱' },
  { id: 'c6', name: 'Lainnya', icon: '🐾' },
];

export default function App() {
  // --- GLOBAL STATE ---
  const [user, setUser] = useState(null); 
  const [userProfile, setUserProfile] = useState(null);
  
  const [activeTab, setActiveTab] = useState('home'); 
  const [activeView, setActiveView] = useState('auth'); 
  
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [toast, setToast] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // --- HELPERS ---
  const formatRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  
  const navigateTo = (view, tab = activeTab) => {
    setActiveView(view);
    if (view === 'main') setActiveTab(tab);
  };

  // --- FIREBASE EFFECTS ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        }
      } catch (e) {
        console.error("Auth Init Error", e);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setUserProfile(null);
        setActiveView('auth');
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Fetch User Profile
    const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
    const unsubUser = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserProfile(docSnap.data());
        if (activeView === 'auth') {
          navigateTo('main', docSnap.data().role === 'seller' ? 'dashboard' : 'home');
        }
      }
      setIsLoading(false);
    });

    // Fetch All Products
    const prodRef = collection(db, 'artifacts', appId, 'public', 'data', 'products');
    const unsubProducts = onSnapshot(prodRef, (snapshot) => {
      const prods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProducts(prods);
    });

    // Fetch All Orders
    const ordRef = collection(db, 'artifacts', appId, 'public', 'data', 'orders');
    const unsubOrders = onSnapshot(ordRef, (snapshot) => {
      const ords = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort descending by date locally
      ords.sort((a, b) => new Date(b.date) - new Date(a.date));
      setOrders(ords);
    });

    return () => {
      unsubUser();
      unsubProducts();
      unsubOrders();
    };
  }, [user]);

  // --- CART FUNCTIONS ---
  const addToCart = (product) => {
    if (product.stock <= 0) {
      showToast('Maaf, stok produk habis!'); return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (existing.qty + 1 > product.stock) {
          showToast('Maksimal stok tercapai!'); return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...prev, { ...product, qty: 1 }];
    });
    showToast('Berhasil ditambahkan ke keranjang!');
  };

  const updateCartQty = (id, delta) => {
    const product = products.find(p => p.id === id);
    if (!product) return;
    setCart(prev => prev.map(item => {
      if (item.id === id) {
        const newQty = item.qty + delta;
        if (newQty > product.stock) {
          showToast('Maksimal stok tercapai!'); return item;
        }
        return newQty > 0 ? { ...item, qty: newQty } : item;
      }
      return item;
    }));
  };

  const removeCartItem = (id) => setCart(prev => prev.filter(item => item.id !== id));
  const getCartTotal = () => cart.reduce((total, item) => total + (item.price * item.qty), 0);

  // --- CHECKOUT FUNCTION ---
  const handleCheckout = async (paymentMethod) => {
    if (cart.length === 0) return;
    try {
      const newOrderRef = doc(collection(db, 'artifacts', appId, 'public', 'data', 'orders'));
      
      // Reduce Stock First
      for (const item of cart) {
        const productRef = doc(db, 'artifacts', appId, 'public', 'data', 'products', item.id);
        const currentProduct = products.find(p => p.id === item.id);
        if (currentProduct) {
          await updateDoc(productRef, {
            stock: currentProduct.stock - item.qty,
            sold: (currentProduct.sold || 0) + item.qty
          });
        }
      }

      // Save Order
      await setDoc(newOrderRef, {
        date: new Date().toISOString(),
        items: cart,
        total: getCartTotal() + 15000,
        status: 'Menunggu Pembayaran',
        paymentMethod,
        buyerId: user.uid,
        buyerName: userProfile.name,
        sellerIds: [...new Set(cart.map(c => c.sellerId))]
      });

      setCart([]);
      showToast('Pesanan berhasil dibuat!');
      navigateTo('main', 'orders');
    } catch (e) {
      showToast('Gagal checkout: ' + e.message);
    }
  };

  // --- VIEWS ---
  if (isLoading && activeView !== 'auth') {
    return <div className="flex h-screen items-center justify-center bg-[#FFF8E1] text-[#8D6E63]">Memuat data...</div>;
  }

  const AuthView = () => {
    const [isLogin, setIsLogin] = useState(true);
    const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'buyer' });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setError('');
      setLoading(true);
      try {
        if (isLogin) {
          await signInWithEmailAndPassword(auth, formData.email, formData.password);
        } else {
          if (!formData.name) throw new Error("Nama harus diisi");
          const userCred = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
          await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'users', userCred.user.uid), {
            id: userCred.user.uid,
            name: formData.name,
            role: formData.role,
            email: formData.email
          });
        }
      } catch (err) {
        setError(err.message.replace('Firebase:', ''));
      }
      setLoading(false);
    };

    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#4CAF50] text-white p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-green-400 rounded-full mix-blend-multiply filter blur-3xl opacity-70"></div>
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#8D6E63] rounded-full mix-blend-multiply filter blur-3xl opacity-50"></div>
        
        <div className="w-24 h-24 bg-[#FFF8E1] rounded-full flex items-center justify-center mb-4 shadow-lg z-10">
          <Leaf className="text-[#4CAF50] w-12 h-12" />
        </div>
        <h1 className="text-4xl font-bold mb-2 z-10 text-white">Pakanku</h1>
        <p className="mb-8 text-[#FFF8E1] text-center z-10">Marketplace Pakan Ternak<br/><span className="text-sm opacity-90">Dari Peternak, Untuk Peternak</span></p>
        
        <div className="w-full max-w-sm space-y-4 bg-[#FFF8E1] p-6 rounded-3xl shadow-2xl text-[#5D4037] z-10 border border-[#8D6E63]/20">
          <h2 className="font-bold text-center text-xl mb-4">{isLogin ? 'Masuk ke Akun Anda' : 'Buat Akun Baru'}</h2>
          {error && <div className="bg-red-100 text-red-600 p-3 rounded-xl text-xs text-center font-medium">{error}</div>}
          
          <form onSubmit={handleSubmit} className="space-y-3">
            {!isLogin && (
              <input type="text" placeholder="Nama Lengkap / Toko" required
                className="w-full px-4 py-3 rounded-xl border border-[#8D6E63]/30 focus:outline-none focus:ring-2 focus:ring-[#4CAF50] bg-white"
                value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
              />
            )}
            <input type="email" placeholder="Email" required
              className="w-full px-4 py-3 rounded-xl border border-[#8D6E63]/30 focus:outline-none focus:ring-2 focus:ring-[#4CAF50] bg-white"
              value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
            />
            <input type="password" placeholder="Password" required
              className="w-full px-4 py-3 rounded-xl border border-[#8D6E63]/30 focus:outline-none focus:ring-2 focus:ring-[#4CAF50] bg-white"
              value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
            />
            
            {!isLogin && (
              <div className="flex gap-2 pt-2">
                <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer font-medium text-sm transition ${formData.role === 'buyer' ? 'bg-[#4CAF50]/10 border-[#4CAF50] text-[#4CAF50]' : 'bg-white border-[#8D6E63]/30 text-[#8D6E63]'}`}>
                  <input type="radio" className="hidden" checked={formData.role === 'buyer'} onChange={() => setFormData({...formData, role: 'buyer'})} />
                  🛒 Pembeli
                </label>
                <label className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer font-medium text-sm transition ${formData.role === 'seller' ? 'bg-[#8D6E63]/10 border-[#8D6E63] text-[#8D6E63]' : 'bg-white border-[#8D6E63]/30 text-[#8D6E63]'}`}>
                  <input type="radio" className="hidden" checked={formData.role === 'seller'} onChange={() => setFormData({...formData, role: 'seller'})} />
                  🏪 Penjual
                </label>
              </div>
            )}
            
            <button disabled={loading} type="submit" className="w-full bg-[#4CAF50] text-white py-3.5 rounded-xl font-bold hover:bg-[#388E3C] transition shadow-md mt-4 disabled:opacity-70">
              {loading ? 'Memproses...' : (isLogin ? 'Masuk' : 'Daftar')}
            </button>
          </form>

          <p className="text-center text-sm font-medium text-[#8D6E63] mt-4">
            {isLogin ? "Belum punya akun?" : "Sudah punya akun?"} 
            <button onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-[#4CAF50] font-bold ml-1 hover:underline">
              {isLogin ? 'Daftar' : 'Masuk'}
            </button>
          </p>
        </div>
      </div>
    );
  };

  const BuyerHomeTab = () => (
    <div className="flex flex-col h-full overflow-y-auto bg-[#FFF8E1] pb-24">
      {/* Header */}
      <div className="bg-[#4CAF50] p-4 sticky top-0 z-10 shadow-sm rounded-b-2xl">
        <div className="flex gap-2">
          <div className="flex-1 bg-white rounded-xl flex items-center px-4 py-2 shadow-inner">
            <Search size={20} className="text-gray-400" />
            <input type="text" placeholder="Cari pakan ternak..." className="ml-2 w-full outline-none text-sm text-[#5D4037]" />
          </div>
        </div>
      </div>

      {/* Banner */}
      <div className="p-4">
        <div className="bg-gradient-to-r from-[#8D6E63] to-[#5D4037] rounded-2xl h-36 flex items-center p-5 text-white shadow-lg relative overflow-hidden">
          <div className="z-10">
            <h3 className="font-bold text-xl mb-1 text-[#FFF8E1]">Panen Berkah!</h3>
            <p className="text-sm text-[#FFF8E1]/80 mb-3">Temukan pakan terbaik langsung dari pabrik</p>
          </div>
          <Leaf size={100} className="absolute -right-6 -bottom-6 text-[#A1887F] opacity-40 rotate-12" />
        </div>
      </div>

      {/* Recommended Products */}
      <div className="p-4">
        <h3 className="font-bold text-[#5D4037] mb-4 flex items-center gap-2 text-lg">
          <span className="bg-[#4CAF50] w-1.5 h-6 rounded-full"></span> Pilihan Peternak
        </h3>
        {products.length === 0 ? (
          <div className="text-center text-[#8D6E63] mt-10 opacity-70">Belum ada produk dari penjual.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {products.map(product => (
              <div key={product.id} onClick={() => { setSelectedProduct(product); navigateTo('product'); }}
                className={`bg-white rounded-2xl overflow-hidden shadow-sm border border-[#8D6E63]/20 cursor-pointer transition-transform relative ${product.stock <= 0 ? 'opacity-70' : 'hover:shadow-md'}`}
              >
                {product.stock <= 0 && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-10">
                    <span className="bg-red-600 text-white font-bold px-3 py-1 rounded-full text-xs shadow-lg">Habis Terjual</span>
                  </div>
                )}
                <div className="relative">
                  <img src={product.image || "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300"} alt={product.name} className="w-full aspect-square object-cover" />
                  <div className="absolute bottom-2 left-2 bg-[#5D4037]/70 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Star size={10} className="fill-yellow-400 text-yellow-400"/> {product.rating || 'Baru'}
                  </div>
                </div>
                <div className="p-3">
                  <h4 className="text-sm font-medium text-[#5D4037] line-clamp-2 leading-tight mb-1.5 min-h-[2.5rem]">{product.name}</h4>
                  <p className="text-[#4CAF50] font-bold text-base mb-2">{formatRp(product.price)}</p>
                  <div className="flex items-center justify-between text-xs text-[#8D6E63] font-medium">
                    <span>Stok: {product.stock}</span>
                    <span>Terjual: {product.sold || 0}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const ProductDetailView = () => {
    if (!selectedProduct) return null;
    const isOutOfStock = selectedProduct.stock <= 0;

    return (
      <div className="flex flex-col h-screen bg-[#FFF8E1]">
        <div className="absolute top-4 left-4 z-20">
          <button onClick={() => navigateTo('main')} className="bg-[#5D4037]/60 p-2.5 rounded-full text-white backdrop-blur-md shadow-lg hover:bg-[#5D4037] transition">
            <ChevronLeft size={24} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-24">
          <div className="relative">
            <img src={selectedProduct.image || "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300"} alt={selectedProduct.name} className="w-full aspect-square object-cover" />
            {isOutOfStock && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="bg-red-600 text-white font-bold px-6 py-2 rounded-full text-lg shadow-2xl border-2 border-white/20">STOK HABIS</span>
              </div>
            )}
          </div>
          
          <div className="bg-white p-5 mb-2 shadow-sm border-b border-[#8D6E63]/20 rounded-b-3xl">
            <div className="text-[#4CAF50] font-bold text-3xl mb-2">{formatRp(selectedProduct.price)}</div>
            <h1 className="text-xl text-[#5D4037] font-bold leading-snug mb-4">{selectedProduct.name}</h1>
            <div className="flex items-center gap-4 text-sm font-medium text-[#8D6E63]">
              <span className="flex items-center gap-1.5"><Star size={18} className="text-yellow-400 fill-yellow-400" /> {selectedProduct.rating || '0'}</span>
              <span className="w-1 h-1 rounded-full bg-[#8D6E63]/40"></span>
              <span>Terjual {selectedProduct.sold || 0}</span>
              <span className="w-1 h-1 rounded-full bg-[#8D6E63]/40"></span>
              <span className={isOutOfStock ? 'text-red-500 font-bold' : ''}>Stok: {selectedProduct.stock}</span>
            </div>
          </div>

          <div className="bg-white p-4 mb-2 flex items-center gap-4 shadow-sm border-y border-[#8D6E63]/20">
            <div className="w-14 h-14 bg-[#FFF8E1] border border-[#8D6E63]/30 rounded-full flex items-center justify-center shadow-inner">
              <Store size={28} className="text-[#8D6E63]" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-[#5D4037] text-lg">{selectedProduct.sellerName}</h3>
              <p className="text-xs font-medium text-[#8D6E63] flex items-center gap-1 mt-0.5"><MapPin size={12}/> Toko Pakan Online</p>
            </div>
          </div>

          <div className="bg-white p-5 shadow-sm border-t border-[#8D6E63]/20">
            <h3 className="font-bold text-[#5D4037] mb-3 text-lg">Deskripsi Pakan</h3>
            <p className="text-sm text-[#8D6E63] leading-relaxed whitespace-pre-line font-medium">{selectedProduct.desc}</p>
          </div>
        </div>

        {/* Bottom Bar For Buyer */}
        {userProfile?.role === 'buyer' && (
          <div className="bg-white border-t border-[#8D6E63]/20 p-3 flex gap-2 fixed bottom-0 w-full shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.05)] z-30">
            <button disabled={isOutOfStock} onClick={() => addToCart(selectedProduct)}
              className={`flex-1 font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition border-2 ${isOutOfStock ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-[#4CAF50]/10 text-[#4CAF50] border-[#4CAF50]/30 hover:bg-[#4CAF50]/20'}`}>
              <ShoppingCart size={20} /> Keranjang
            </button>
            <button disabled={isOutOfStock} onClick={() => { addToCart(selectedProduct); if(!isOutOfStock) navigateTo('main', 'cart'); }}
              className={`flex-1 font-bold py-3.5 rounded-xl shadow-md transition ${isOutOfStock ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-[#4CAF50] text-white hover:bg-[#388E3C]'}`}>
              Beli Sekarang
            </button>
          </div>
        )}
      </div>
    );
  };

  const CartTab = () => (
    <div className="flex flex-col h-screen bg-[#FFF8E1]">
      <div className="bg-[#4CAF50] p-4 text-center font-bold text-lg text-white shadow-sm sticky top-0 z-10 rounded-b-2xl">Keranjang Belanja</div>
      
      <div className="flex-1 overflow-y-auto p-4 pb-32">
        {cart.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[#8D6E63] gap-4 mt-24">
            <ShoppingCart size={64} className="text-[#8D6E63]/50" />
            <p className="font-medium text-lg">Keranjang masih kosong</p>
            <button onClick={() => setActiveTab('home')} className="mt-2 px-8 py-3 bg-[#4CAF50] text-white rounded-full font-bold shadow-md hover:bg-[#388E3C] transition">Beli Pakan Dulu</button>
          </div>
        ) : (
          <div className="space-y-4">
            {cart.map(item => {
              const productData = products.find(p => p.id === item.id);
              const isExceeding = item.qty > (productData?.stock || 0);

              return (
                <div key={item.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#8D6E63]/20 flex gap-4">
                  <img src={item.image || "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300"} alt={item.name} className="w-24 h-24 rounded-xl object-cover border border-[#FFF8E1]" />
                  <div className="flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-[#5D4037] line-clamp-2 leading-tight mb-1">{item.name}</h4>
                      <p className="text-[#4CAF50] font-bold text-base">{formatRp(item.price)}</p>
                    </div>
                    {isExceeding && <p className="text-xs font-bold text-red-500 mt-1">Stok sisa {productData?.stock || 0}!</p>}
                    <div className="flex items-center justify-between mt-2">
                      <button onClick={() => removeCartItem(item.id)} className="text-[#8D6E63]/50 hover:text-red-500 transition"><Trash2 size={20} /></button>
                      <div className="flex items-center gap-3 bg-[#FFF8E1] border border-[#8D6E63]/30 rounded-lg px-2 py-1 shadow-inner">
                        <button onClick={() => updateCartQty(item.id, -1)} className="text-[#8D6E63] p-1 hover:bg-[#8D6E63]/20 rounded-md transition"><Minus size={16} /></button>
                        <span className="text-sm font-bold w-6 text-center text-[#5D4037]">{item.qty}</span>
                        <button onClick={() => updateCartQty(item.id, 1)} className="text-[#8D6E63] p-1 hover:bg-[#8D6E63]/20 rounded-md transition"><Plus size={16} /></button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {cart.length > 0 && (
        <div className="bg-white border-t border-[#8D6E63]/20 p-4 pb-20 fixed bottom-0 w-full flex items-center justify-between shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.05)] z-20">
          <div>
            <p className="text-xs font-medium text-[#8D6E63] mb-0.5">Total Harga</p>
            <p className="text-xl font-bold text-[#4CAF50]">{formatRp(getCartTotal())}</p>
          </div>
          <button 
            onClick={() => navigateTo('checkout')}
            disabled={cart.some(item => item.qty > (products.find(p=>p.id===item.id)?.stock || 0))}
            className="bg-[#4CAF50] disabled:bg-gray-400 text-white px-8 py-3.5 rounded-xl font-bold shadow-md hover:bg-[#388E3C] transition">
            Checkout ({cart.reduce((a,b)=>a+b.qty,0)})
          </button>
        </div>
      )}
    </div>
  );

  const CheckoutView = () => {
    const [method, setMethod] = useState('Transfer Bank');
    const subtotal = getCartTotal();
    const ongkir = 15000;
    const total = subtotal + ongkir;

    return (
      <div className="flex flex-col h-screen bg-[#FFF8E1]">
        <div className="bg-[#4CAF50] p-4 flex items-center gap-3 shadow-sm sticky top-0 z-10 text-white rounded-b-2xl">
          <button onClick={() => navigateTo('main', 'cart')}><ChevronLeft size={24} /></button>
          <h1 className="font-bold text-lg">Checkout</h1>
        </div>

        <div className="flex-1 overflow-y-auto pb-32">
          <div className="bg-white p-5 mb-2 shadow-sm border-b border-[#8D6E63]/20">
            <h3 className="font-bold text-[#5D4037] flex items-center gap-2 mb-3"><MapPin size={20} className="text-[#4CAF50]" /> Alamat Pengiriman</h3>
            <div className="bg-[#FFF8E1] p-4 rounded-xl border border-[#8D6E63]/30">
              <p className="text-sm font-bold text-[#5D4037] mb-1">{userProfile?.name}</p>
              <p className="text-xs font-medium text-[#8D6E63] leading-relaxed">Alamat tersimpan di profil pengguna.</p>
            </div>
          </div>

          <div className="bg-white p-5 mb-2 shadow-sm border-y border-[#8D6E63]/20">
            <h3 className="font-bold text-[#5D4037] mb-4 text-lg">Pesanan Pakan</h3>
            {cart.map(item => (
              <div key={item.id} className="flex gap-4 mb-4 border-b border-[#8D6E63]/20 pb-4 last:border-0 last:pb-0">
                <img src={item.image || "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300"} alt={item.name} className="w-16 h-16 rounded-xl object-cover border border-[#FFF8E1] shadow-sm" />
                <div className="flex-1 flex flex-col justify-center">
                  <h4 className="text-sm font-medium text-[#5D4037] line-clamp-1 mb-1">{item.name}</h4>
                  <div className="flex justify-between items-center">
                    <p className="text-xs font-medium text-[#8D6E63]">{item.qty} x {formatRp(item.price)}</p>
                    <p className="text-sm font-bold text-[#5D4037]">{formatRp(item.qty * item.price)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white p-5 mb-2 shadow-sm border-y border-[#8D6E63]/20">
            <h3 className="font-bold text-[#5D4037] mb-4 text-lg">Metode Pembayaran</h3>
            <div className="space-y-3">
              {['Transfer Bank', 'COD (Bayar di Tempat)'].map(m => (
                <label key={m} className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition shadow-sm ${method === m ? 'border-[#4CAF50] bg-[#4CAF50]/10' : 'border-[#8D6E63]/20 bg-white hover:border-[#8D6E63]/50'}`}>
                  <input type="radio" name="payment" checked={method === m} onChange={() => setMethod(m)} className="text-[#4CAF50] w-4 h-4 accent-[#4CAF50]" />
                  <span className={`text-sm font-bold ${method === m ? 'text-[#388E3C]' : 'text-[#5D4037]'}`}>{m}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-white p-5 shadow-sm border-t border-[#8D6E63]/20">
            <h3 className="font-bold text-[#5D4037] mb-4 text-lg">Rincian Pembayaran</h3>
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm font-medium text-[#8D6E63]"><span>Subtotal Pakan</span><span>{formatRp(subtotal)}</span></div>
              <div className="flex justify-between text-sm font-medium text-[#8D6E63]"><span>Ongkos Kirim</span><span>{formatRp(ongkir)}</span></div>
            </div>
            <div className="flex justify-between font-bold text-[#5D4037] pt-4 border-t border-[#8D6E63]/20 text-lg">
              <span>Total Pembayaran</span><span className="text-[#4CAF50]">{formatRp(total)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white border-t border-[#8D6E63]/20 p-4 fixed bottom-0 w-full flex items-center justify-between shadow-[0_-8px_15px_-3px_rgba(0,0,0,0.05)] z-20">
          <div>
            <p className="text-xs font-medium text-[#8D6E63] mb-0.5">Total Pembayaran</p>
            <p className="text-xl font-bold text-[#4CAF50]">{formatRp(total)}</p>
          </div>
          <button onClick={() => handleCheckout(method)} className="bg-[#4CAF50] text-white px-8 py-3.5 rounded-xl font-bold shadow-md hover:bg-[#388E3C] transition">Buat Pesanan</button>
        </div>
      </div>
    );
  };

  const OrdersTab = () => {
    const isSeller = userProfile?.role === 'seller';
    
    // Filter orders based on Role
    let filteredOrders = orders;
    if (isSeller) {
      filteredOrders = orders.filter(o => o.sellerIds && o.sellerIds.includes(user.uid));
    } else {
      filteredOrders = orders.filter(o => o.buyerId === user.uid);
    }

    const updateStatus = async (orderId, newStatus) => {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'orders', orderId), { status: newStatus });
      showToast(`Status pesanan diperbarui menjadi ${newStatus}`);
    };

    return (
      <div className="flex flex-col h-screen bg-[#FFF8E1]">
        <div className="bg-[#4CAF50] text-white p-4 text-center font-bold text-lg shadow-sm sticky top-0 z-20 rounded-b-2xl">
          {isSeller ? 'Pesanan Masuk' : 'Pesanan Saya'}
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
          {filteredOrders.length === 0 ? (
            <div className="text-center text-[#8D6E63] mt-16 font-medium">Belum ada pesanan saat ini.</div>
          ) : (
            filteredOrders.map(order => (
              <div key={order.id} className="bg-white rounded-2xl p-5 shadow-sm border border-[#8D6E63]/20">
                <div className="flex justify-between items-center mb-4 pb-4 border-b border-[#8D6E63]/20">
                  <div className="flex items-center gap-2">
                    <Store size={18} className="text-[#8D6E63]" />
                    <span className="font-bold text-sm text-[#5D4037]">{isSeller ? `Pembeli: ${order.buyerName}` : 'Detail Pesanan'}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-md shadow-sm uppercase tracking-wide ${
                    order.status === 'Selesai' ? 'bg-[#4CAF50]/20 text-[#4CAF50] border border-[#4CAF50]/30' : 
                    order.status === 'Menunggu Pembayaran' ? 'bg-red-100 text-red-700 border border-red-200' : 
                    'bg-[#8D6E63]/20 text-[#8D6E63] border border-[#8D6E63]/30'
                  }`}>
                    {order.status}
                  </span>
                </div>
                
                {order.items.filter(item => !isSeller || item.sellerId === user.uid).map((item, idx) => (
                  <div key={idx} className="flex gap-4 mb-3 last:mb-0">
                    <img src={item.image || "https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300"} alt={item.name} className="w-16 h-16 rounded-xl object-cover border border-[#FFF8E1]" />
                    <div className="flex-1">
                      <h4 className="text-sm font-bold text-[#5D4037] line-clamp-1 mb-1">{item.name}</h4>
                      <p className="text-xs font-medium text-[#8D6E63]">{item.qty} karung/pack x {formatRp(item.price)}</p>
                    </div>
                  </div>
                ))}
                
                <div className="flex justify-between items-center pt-4 border-t border-[#8D6E63]/20 mt-4">
                  <p className="text-xs font-medium text-[#8D6E63]">Total Pesanan</p>
                  <p className="font-bold text-[#4CAF50] text-lg">{formatRp(order.total)}</p>
                </div>
                
                {/* SELLER CONTROLS */}
                {isSeller && order.status === 'Menunggu Pembayaran' && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateStatus(order.id, 'Diproses')} className="flex-1 bg-[#4CAF50] text-white py-2 rounded-xl text-sm font-bold shadow hover:bg-[#388E3C] transition">Proses Pesanan</button>
                  </div>
                )}
                {isSeller && order.status === 'Diproses' && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateStatus(order.id, 'Dikirim')} className="flex-1 bg-[#8D6E63] text-white py-2 rounded-xl text-sm font-bold shadow hover:bg-[#5D4037] transition">Kirim Pesanan</button>
                  </div>
                )}
                
                {/* BUYER CONTROLS */}
                {!isSeller && order.status === 'Dikirim' && (
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => updateStatus(order.id, 'Selesai')} className="flex-1 bg-[#4CAF50] text-white py-2 rounded-xl text-sm font-bold shadow hover:bg-[#388E3C] transition">Pesanan Diterima</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const SellerDashboard = () => {
    const [isAdding, setIsAdding] = useState(false);
    const [editId, setEditId] = useState(null);
    const [formProd, setFormProd] = useState({ name: '', price: '', stock: '', category: 'Ayam', desc: '', image: '' });

    const myProducts = products.filter(p => p.sellerId === user.uid);

    const handleSubmitProduct = async (e) => {
      e.preventDefault();
      try {
        const payload = {
          name: formProd.name,
          price: Number(formProd.price),
          stock: Number(formProd.stock),
          category: formProd.category,
          desc: formProd.desc,
          image: formProd.image || 'https://images.unsplash.com/photo-1524704654690-b56c05c78a00?auto=format&fit=crop&q=80&w=300&h=300',
          sellerId: user.uid,
          sellerName: userProfile.name,
          rating: 0,
          sold: 0
        };

        if (editId) {
          await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', editId), payload);
          showToast('Produk diperbarui!');
        } else {
          await setDoc(doc(collection(db, 'artifacts', appId, 'public', 'data', 'products')), payload);
          showToast('Produk ditambahkan!');
        }
        setIsAdding(false);
        setEditId(null);
        setFormProd({ name: '', price: '', stock: '', category: 'Ayam', desc: '', image: '' });
      } catch (e) {
        showToast('Gagal menyimpan: ' + e.message);
      }
    };

    const handleDeleteProduct = async (id) => {
      if(confirm('Yakin hapus produk ini?')) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'products', id));
        showToast('Produk dihapus!');
      }
    };

    const handleEdit = (prod) => {
      setFormProd({ ...prod });
      setEditId(prod.id);
      setIsAdding(true);
    };

    if (isAdding) {
      return (
        <div className="flex flex-col h-screen bg-[#FFF8E1] p-4 pb-24 overflow-y-auto">
          <div className="flex items-center mb-6">
            <button onClick={() => { setIsAdding(false); setEditId(null); }} className="text-[#8D6E63] p-2 bg-white rounded-full shadow"><ChevronLeft /></button>
            <h2 className="text-xl font-bold text-[#5D4037] ml-4">{editId ? 'Edit Produk' : 'Tambah Produk Baru'}</h2>
          </div>
          
          <form onSubmit={handleSubmitProduct} className="space-y-4 bg-white p-5 rounded-2xl shadow-sm border border-[#8D6E63]/20">
            <div>
              <label className="text-xs font-bold text-[#8D6E63] mb-1 block">Nama Pakan</label>
              <input required type="text" className="w-full border-b border-[#8D6E63]/30 py-2 focus:outline-none focus:border-[#4CAF50] text-[#5D4037]" value={formProd.name} onChange={e => setFormProd({...formProd, name: e.target.value})} />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs font-bold text-[#8D6E63] mb-1 block">Harga (Rp)</label>
                <input required type="number" className="w-full border-b border-[#8D6E63]/30 py-2 focus:outline-none focus:border-[#4CAF50] text-[#5D4037]" value={formProd.price} onChange={e => setFormProd({...formProd, price: e.target.value})} />
              </div>
              <div className="flex-1">
                <label className="text-xs font-bold text-[#8D6E63] mb-1 block">Stok</label>
                <input required type="number" className="w-full border-b border-[#8D6E63]/30 py-2 focus:outline-none focus:border-[#4CAF50] text-[#5D4037]" value={formProd.stock} onChange={e => setFormProd({...formProd, stock: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-[#8D6E63] mb-1 block">Kategori Hewan</label>
              <select className="w-full border-b border-[#8D6E63]/30 py-2 focus:outline-none focus:border-[#4CAF50] text-[#5D4037]" value={formProd.category} onChange={e => setFormProd({...formProd, category: e.target.value})}>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-[#8D6E63] mb-1 block">URL Gambar (Opsional)</label>
              <input type="text" placeholder="https://..." className="w-full border-b border-[#8D6E63]/30 py-2 focus:outline-none focus:border-[#4CAF50] text-[#5D4037] text-sm" value={formProd.image} onChange={e => setFormProd({...formProd, image: e.target.value})} />
            </div>
            <div>
              <label className="text-xs font-bold text-[#8D6E63] mb-1 block">Deskripsi</label>
              <textarea required rows="3" className="w-full border border-[#8D6E63]/30 rounded-xl p-3 focus:outline-none focus:border-[#4CAF50] text-[#5D4037] text-sm mt-1" value={formProd.desc} onChange={e => setFormProd({...formProd, desc: e.target.value})}></textarea>
            </div>
            <button type="submit" className="w-full bg-[#4CAF50] text-white py-3.5 rounded-xl font-bold shadow-md hover:bg-[#388E3C] transition mt-2">Simpan Produk</button>
          </form>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-screen bg-[#FFF8E1]">
        <div className="bg-[#4CAF50] text-white p-4 flex justify-between items-center shadow-sm sticky top-0 z-10 rounded-b-2xl">
          <h1 className="font-bold text-lg">Toko Saya</h1>
          <button onClick={() => setIsAdding(true)} className="bg-white text-[#4CAF50] px-3 py-1.5 rounded-full text-xs font-bold shadow flex items-center gap-1"><Plus size={14}/> Tambah</button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-[#8D6E63]/20 flex items-center gap-4">
            <div className="w-12 h-12 bg-[#FFF8E1] rounded-full flex items-center justify-center text-[#8D6E63] border border-[#8D6E63]/30"><Store /></div>
            <div>
              <h3 className="font-bold text-[#5D4037]">{userProfile?.name}</h3>
              <p className="text-xs text-[#8D6E63]">{myProducts.length} Produk Aktif</p>
            </div>
          </div>

          <h3 className="font-bold text-[#5D4037] mt-6 mb-2">Daftar Produk</h3>
          {myProducts.length === 0 ? (
            <p className="text-center text-[#8D6E63] mt-8 text-sm">Belum ada produk jualan. Tambahkan sekarang!</p>
          ) : (
            myProducts.map(prod => (
              <div key={prod.id} className="bg-white p-4 rounded-2xl shadow-sm border border-[#8D6E63]/20 flex gap-4">
                 <img src={prod.image} alt={prod.name} className="w-20 h-20 rounded-xl object-cover border border-[#FFF8E1]" />
                 <div className="flex-1">
                   <h4 className="text-sm font-bold text-[#5D4037] line-clamp-1">{prod.name}</h4>
                   <p className="text-[#4CAF50] font-bold text-sm mb-1">{formatRp(prod.price)}</p>
                   <p className="text-xs text-[#8D6E63] mb-2">Sisa Stok: <span className="font-bold">{prod.stock}</span></p>
                   <div className="flex gap-2">
                     <button onClick={() => handleEdit(prod)} className="flex-1 bg-[#FFF8E1] text-[#8D6E63] py-1.5 rounded-lg text-xs font-bold border border-[#8D6E63]/30 flex items-center justify-center gap-1"><Edit2 size={12}/> Edit</button>
                     <button onClick={() => handleDeleteProduct(prod.id)} className="bg-red-50 text-red-500 px-3 rounded-lg border border-red-100 flex items-center justify-center hover:bg-red-100"><Trash2 size={14}/></button>
                   </div>
                 </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  const ProfileTab = () => (
    <div className="flex flex-col h-screen bg-[#FFF8E1] p-6 items-center justify-center relative">
      <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center shadow-lg border-4 border-[#4CAF50] mb-4">
        <UserIcon size={40} className="text-[#8D6E63]" />
      </div>
      <h2 className="text-2xl font-bold text-[#5D4037] mb-1">{userProfile?.name}</h2>
      <span className="bg-[#4CAF50]/10 text-[#4CAF50] px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest border border-[#4CAF50]/30 mb-8">{userProfile?.role}</span>
      
      <p className="text-[#8D6E63] text-sm mb-10">{userProfile?.email}</p>
      
      <button onClick={() => signOut(auth)} className="w-full max-w-xs bg-white border border-[#8D6E63]/30 text-[#8D6E63] py-3.5 rounded-2xl font-bold shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition flex items-center justify-center gap-2">
        <LogOut size={18}/> Keluar Akun
      </button>
    </div>
  );

  // --- MAIN RENDER ---
  return (
    <div className="w-full max-w-md mx-auto h-screen relative bg-white overflow-hidden shadow-2xl">
      {toast && (
        <div className="absolute top-10 left-1/2 transform -translate-x-1/2 bg-[#5D4037] text-white px-5 py-2.5 rounded-full text-sm font-bold shadow-2xl z-50 animate-bounce flex items-center gap-2 whitespace-nowrap">
           <Check size={16} className="text-[#4CAF50]"/> {toast}
        </div>
      )}

      {activeView === 'auth' && <AuthView />}
      {activeView === 'main' && activeTab === 'home' && <BuyerHomeTab />}
      {activeView === 'main' && activeTab === 'dashboard' && <SellerDashboard />}
      {activeView === 'main' && activeTab === 'cart' && <CartTab />}
      {activeView === 'main' && activeTab === 'orders' && <OrdersTab />}
      {activeView === 'main' && activeTab === 'profile' && <ProfileTab />}
      {activeView === 'product' && <ProductDetailView />}
      {activeView === 'checkout' && <CheckoutView />}

      {/* BOTTOM NAVIGATION (Only visible on main views) */}
      {activeView === 'main' && (
        <div className="absolute bottom-0 w-full bg-white border-t border-[#8D6E63]/20 flex justify-around p-2 pb-4 shadow-[0_-5px_20px_-5px_rgba(0,0,0,0.1)] z-40 rounded-t-3xl">
          {userProfile?.role === 'buyer' ? (
            <>
              <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center p-2 transition ${activeTab === 'home' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <Home size={24} className={activeTab==='home'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Beranda</span>
              </button>
              <button onClick={() => setActiveTab('cart')} className={`flex flex-col items-center p-2 relative transition ${activeTab === 'cart' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <ShoppingCart size={24} className={activeTab==='cart'?'fill-[#4CAF50]/20':''} />
                {cart.length > 0 && <span className="absolute top-1 right-1 bg-red-500 text-white text-[10px] w-4 h-4 flex items-center justify-center rounded-full font-bold">{cart.length}</span>}
                <span className="text-[10px] font-bold mt-1">Keranjang</span>
              </button>
              <button onClick={() => setActiveTab('orders')} className={`flex flex-col items-center p-2 transition ${activeTab === 'orders' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <Package size={24} className={activeTab==='orders'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Pesanan</span>
              </button>
              <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center p-2 transition ${activeTab === 'profile' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <UserIcon size={24} className={activeTab==='profile'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Profil</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center p-2 transition ${activeTab === 'dashboard' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <Store size={24} className={activeTab==='dashboard'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Toko</span>
              </button>
              <button onClick={() => setActiveTab('orders')} className={`flex flex-col items-center p-2 transition ${activeTab === 'orders' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <Package size={24} className={activeTab==='orders'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Pesanan</span>
              </button>
              <button onClick={() => setActiveTab('profile')} className={`flex flex-col items-center p-2 transition ${activeTab === 'profile' ? 'text-[#4CAF50] -translate-y-1' : 'text-[#8D6E63]'}`}>
                <UserIcon size={24} className={activeTab==='profile'?'fill-[#4CAF50]/20':''} />
                <span className="text-[10px] font-bold mt-1">Profil</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
