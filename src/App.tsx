import React, { useState, useEffect } from 'react';
// --- Supabase Credentials ---
const SUPABASE_URL = 'https://dxlzlhoeujlpbrjpjrid.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tv9skPRoecEhxxaMtLy0cw_5c14zay-';

// --- Type Definitions ---
export interface ContractorProfile {
  businessName: string;
  email: string;
  phone: string;
  address: string;
  enableInstantPayment: boolean;
  paymentInstructions: string;
}

export interface OrderItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  createdAt: string;
  contractor: ContractorProfile;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  items: OrderItem[];
  notes: string;
  totalAmount: number;
  signature?: string;
  signedAt?: string;
  paymentStatus: 'UNPAID' | 'PENDING' | 'PAID';
  enableInstantPayment: boolean; // Controls button visibility for client
}

// --- Default Configuration ---
const DEFAULT_CONTRACTOR_PROFILE: ContractorProfile = {
  businessName: '',
  email: '',
  phone: '',
  address: '',
  enableInstantPayment: false, // Defaulted to disabled
  paymentInstructions: 'Please remit payment upon invoice receipt.'
};

export default function App() {
  // --- Contractor Settings State ---
  const [contractorProfile, setContractorProfile] = useState<ContractorProfile>(() => {
    const saved = localStorage.getItem('fieldsign_contractor_profile');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved contractor profile', e);
      }
    }
    return DEFAULT_CONTRACTOR_PROFILE;
  });

  // --- Active Orders State ---
  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('fieldsign_orders');
    return saved ? JSON.parse(saved) : [];
  });

  // --- UI Navigation State ---
  const [activeTab, setActiveTab] = useState<'create' | 'orders' | 'settings' | 'sign'>('create');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Sync profile to localStorage
  useEffect(() => {
    localStorage.setItem('fieldsign_contractor_profile', JSON.stringify(contractorProfile));
  }, [contractorProfile]);

  // Sync orders to localStorage
  useEffect(() => {
    localStorage.setItem('fieldsign_orders', JSON.stringify(orders));
  }, [orders]);
  // --- New Order Form State ---
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [orderItems, setOrderItems] = useState<OrderItem[]>([
    { id: 'item-1', description: '', quantity: 1, unitPrice: 0 }
  ]);
  // Inherit the contractor profile default for new orders
  const [orderInstantPaymentEnabled, setOrderInstantPaymentEnabled] = useState(
    contractorProfile.enableInstantPayment
  );

  // Keep order instant payment flag in sync if contractor changes their default
  useEffect(() => {
    setOrderInstantPaymentEnabled(contractorProfile.enableInstantPayment);
  }, [contractorProfile.enableInstantPayment]);

  // --- Item Handlers ---
  const handleAddItem = () => {
    setOrderItems((prev) => [
      ...prev,
      { id: `item-${Date.now()}`, description: '', quantity: 1, unitPrice: 0 }
    ]);
  };

  const handleUpdateItem = (id: string, field: keyof OrderItem, value: any) => {
    setOrderItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    if (orderItems.length > 1) {
      setOrderItems((prev) => prev.filter((item) => item.id !== id));
    }
  };

  const calculateTotal = () => {
    return orderItems.reduce((acc, item) => acc + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0);
  };

  // --- Order Creation Handler ---
  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName.trim()) {
      alert('Client Name is required.');
      return;
    }

    const newOrder: Order = {
      id: `ord_${Date.now()}`,
      orderNumber: `FS-${Math.floor(100000 + Math.random() * 900000)}`,
      createdAt: new Date().toISOString(),
      contractor: { ...contractorProfile }, // Snapshots current profile
      clientName,
      clientEmail,
      clientPhone,
      clientAddress,
      items: orderItems,
      notes: orderNotes,
      totalAmount: calculateTotal(),
      paymentStatus: 'UNPAID', // Always unpaid upon creation
      enableInstantPayment: orderInstantPaymentEnabled // Strictly inherits toggle state
    };

    setOrders((prev) => [newOrder, ...prev]);

    // Reset Form
    setClientName('');
    setClientEmail('');
    setClientPhone('');
    setClientAddress('');
    setOrderNotes('');
    setOrderItems([{ id: `item-${Date.now()}`, description: '', quantity: 1, unitPrice: 0 }]);
    
    // Direct user to view the newly created order
    setSelectedOrderId(newOrder.id);
    setActiveTab('orders');
  };

  // --- Manual Payment Status Toggle (Contractor Confirmation) ---
  const handleTogglePaymentStatus = (orderId: string) => {
    setOrders((prev) =>
      prev.map((ord) => {
        if (ord.id === orderId) {
          const nextStatus = ord.paymentStatus === 'PAID' ? 'UNPAID' : 'PAID';
          return { ...ord, paymentStatus: nextStatus };
        }
        return ord;
      })
    );
  };
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* --- Top Navigation Header --- */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-amber-500 flex items-center justify-center font-bold text-slate-900">
              FS
            </div>
            <span className="text-xl font-bold tracking-tight">FieldSign</span>
          </div>

          <nav className="flex space-x-1 sm:space-x-2">
            <button
              onClick={() => setActiveTab('create')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                activeTab === 'create' ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              New Order
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                activeTab === 'orders' ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Order History ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                activeTab === 'settings' ? 'bg-amber-500 text-slate-900 font-semibold' : 'text-slate-300 hover:text-white'
              }`}
            >
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* ========================================================= */}
        {/* --- SETTINGS TAB: Manage Contractor Business Info --- */}
        {/* ========================================================= */}
        {activeTab === 'settings' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 max-w-2xl mx-auto overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900">Contractor & Business Profile</h2>
              <p className="text-sm text-slate-500 mt-1">
                These defaults will appear on all new client proposals and invoices.
              </p>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Business / Company Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Electrical Services LLC"
                  value={contractorProfile.businessName}
                  onChange={(e) =>
                    setContractorProfile({ ...contractorProfile, businessName: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    placeholder="contact@business.com"
                    value={contractorProfile.email}
                    onChange={(e) =>
                      setContractorProfile({ ...contractorProfile, email: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="(757) 555-0199"
                    value={contractorProfile.phone}
                    onChange={(e) =>
                      setContractorProfile({ ...contractorProfile, phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Business Address / Location
                </label>
                <input
                  type="text"
                  placeholder="City, State, Zip"
                  value={contractorProfile.address}
                  onChange={(e) =>
                    setContractorProfile({ ...contractorProfile, address: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-start space-x-3">
                  <input
                    type="checkbox"
                    id="enableInstantPaymentDefault"
                    checked={contractorProfile.enableInstantPayment}
                    onChange={(e) =>
                      setContractorProfile({
                        ...contractorProfile,
                        enableInstantPayment: e.target.checked
                      })
                    }
                    className="h-5 w-5 mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                  />
                  <div>
                    <label htmlFor="enableInstantPaymentDefault" className="font-semibold text-slate-900 cursor-pointer">
                      Enable instant payment link on new orders by default
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      When disabled, the client will only sign the agreement without seeing an online payment button.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* --- CREATE TAB: Order Creation Form --- */}
        {/* ========================================================= */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreateOrder} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Create New Service Order</h2>
                <p className="text-sm text-slate-500">Fill in client details and work scope items.</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <span>Contractor: </span>
                <span className="font-semibold text-slate-700">
                  {contractorProfile.businessName || 'Profile Incomplete (Set in Settings)'}
                </span>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Client Info Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Client Full Name *
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="Jane Doe"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Client Email
                  </label>
                  <input
                    type="email"
                    placeholder="jane@client.com"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Client Phone
                  </label>
                  <input
                    type="tel"
                    placeholder="(555) 000-0000"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                    Service / Job Location
                  </label>
                  <input
                    type="text"
                    placeholder="123 Maple Street"
                    value={clientAddress}
                    onChange={(e) => setClientAddress(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Line Items */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-2">
                  Scope of Work & Materials
                </label>
                <div className="space-y-3">
                  {orderItems.map((item, index) => (
                    <div key={item.id} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder={`Description item ${index + 1}`}
                        value={item.description}
                        onChange={(e) => handleUpdateItem(item.id, 'description', e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-amber-500"
                      />
                      <input
                        type="number"
                        min="1"
                        placeholder="Qty"
                        value={item.quantity || ''}
                        onChange={(e) => handleUpdateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-20 px-3 py-2 border border-slate-300 rounded-lg text-sm text-center focus:outline-none"
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Price"
                        value={item.unitPrice || ''}
                        onChange={(e) => handleUpdateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-28 px-3 py-2 border border-slate-300 rounded-lg text-sm text-right focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleAddItem}
                  className="mt-3 text-sm font-semibold text-amber-600 hover:text-amber-700"
                >
                  + Add Line Item
                </button>
              </div>

              {/* Order Notes */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1">
                  Terms / Notes
                </label>
                <textarea
                  rows={2}
                  placeholder="Payment due upon completion. Warranty valid for 12 months."
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              {/* Per-Order Payment Toggle */}
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <label htmlFor="orderPaymentToggle" className="text-sm font-bold text-slate-900 cursor-pointer">
                    Enable Instant Payment Link for this Order
                  </label>
                  <p className="text-xs text-slate-500">
                    If unchecked, the client will only sign the agreement and not be shown an instant checkout button.
                  </p>
                </div>
                <input
                  type="checkbox"
                  id="orderPaymentToggle"
                  checked={orderInstantPaymentEnabled}
                  onChange={(e) => setOrderInstantPaymentEnabled(e.target.checked)}
                  className="h-5 w-5 rounded border-slate-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                />
              </div>

              {/* Order Total & Submit */}
              <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-slate-100 gap-4">
                <div className="text-2xl font-bold text-slate-900">
                  Total: ${calculateTotal().toFixed(2)}
                </div>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold rounded-lg transition shadow-sm"
                >
                  Generate Order Agreement
                </button>
              </div>
            </div>
          </form>
        )}
        {/* ========================================================= */}
        {/* --- ORDERS TAB: Order History & Manual Payment Controls -- */}
        {/* ========================================================= */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Service Orders & Agreements</h2>
                <p className="text-sm text-slate-500">Track signatures, balances, and payment verifications.</p>
              </div>
              <button
                onClick={() => setActiveTab('create')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold rounded-lg text-sm transition"
              >
                + Create Another Order
              </button>
            </div>

            {orders.length === 0 ? (
              <div className="bg-white p-12 text-center rounded-xl border border-slate-200">
                <p className="text-slate-400 font-medium">No service orders created yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {orders.map((ord) => {
                  const isSelected = selectedOrderId === ord.id;
                  return (
                    <div
                      key={ord.id}
                      className={`bg-white rounded-xl border transition-all p-5 shadow-sm ${
                        isSelected ? 'border-amber-500 ring-1 ring-amber-500' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Order Details Header */}
                        <div>
                          <div className="flex items-center space-x-3">
                            <span className="font-mono font-bold text-slate-900 text-lg">{ord.orderNumber}</span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                                ord.paymentStatus === 'PAID'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {ord.paymentStatus}
                            </span>
                            {ord.signature ? (
                              <span className="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider">
                                Signed
                              </span>
                            ) : (
                              <span className="bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider">
                                Awaiting Signature
                              </span>
                            )}
                          </div>
                          
                          <div className="mt-1 text-sm text-slate-600 space-x-2">
                            <span className="font-semibold text-slate-800">{ord.clientName}</span>
                            <span>•</span>
                            <span>{ord.clientPhone || ord.clientEmail || 'No contact provided'}</span>
                            <span>•</span>
                            <span className="text-slate-400">Created: {new Date(ord.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>

                        {/* Order Total & Actions */}
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="text-right mr-2">
                            <div className="text-xs uppercase font-semibold text-slate-400">Order Total</div>
                            <div className="text-lg font-bold text-slate-900">${ord.totalAmount.toFixed(2)}</div>
                          </div>

                          {/* Contractor Verification Toggle */}
                          <button
                            type="button"
                            onClick={() => handleTogglePaymentStatus(ord.id)}
                            className={`px-3 py-2 text-xs font-semibold rounded-lg border transition ${
                              ord.paymentStatus === 'PAID'
                                ? 'border-slate-300 text-slate-700 hover:bg-slate-50'
                                : 'border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {ord.paymentStatus === 'PAID' ? 'Mark as Unpaid' : '✓ Confirm Payment Received'}
                          </button>

                          {/* Open Client Signing Modal/View */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedOrderId(ord.id);
                              setActiveTab('sign');
                            }}
                            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg transition"
                          >
                            Open Signing Document →
                          </button>
                        </div>
                      </div>

                      {/* Line Item Preview Accordion */}
                      <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 flex flex-wrap justify-between items-center gap-2">
                        <div>
                          <span>Items: </span>
                          <span className="text-slate-700 font-medium">
                            {ord.items.map((i) => `${i.description || 'Item'} (${i.quantity}x)`).join(', ')}
                          </span>
                        </div>
                        <div>
                          <span>Instant Checkout Status: </span>
                          <span className="font-semibold text-slate-700">
                            {ord.enableInstantPayment ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {/* ========================================================= */}
        {/* --- SIGN TAB: Client Signing View & Guarded Actions ----- */}
        {/* ========================================================= */}
        {activeTab === 'sign' && selectedOrderId && (() => {
          const currentOrder = orders.find((o) => o.id === selectedOrderId);
          if (!currentOrder) {
            return (
              <div className="text-center py-12">
                <p className="text-slate-500">Order not found.</p>
                <button
                  onClick={() => setActiveTab('orders')}
                  className="mt-4 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm"
                >
                  Return to Orders
                </button>
              </div>
            );
          }

          return (
            <div className="max-w-3xl mx-auto space-y-6">
              {/* Back Bar */}
              <div className="flex justify-between items-center">
                <button
                  onClick={() => setActiveTab('orders')}
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  ← Back to Order List
                </button>
                <div className="text-xs text-slate-400">
                  Document ID: <span className="font-mono">{currentOrder.id}</span>
                </div>
              </div>

              {/* Printable / Viewable Agreement */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-8 sm:p-10 space-y-8">
                {/* Document Header */}
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 border-b border-slate-100 pb-6">
                  <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                      {currentOrder.contractor.businessName || 'Service Agreement'}
                    </h1>
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                      {currentOrder.contractor.email && <p>{currentOrder.contractor.email}</p>}
                      {currentOrder.contractor.phone && <p>{currentOrder.contractor.phone}</p>}
                      {currentOrder.contractor.address && <p>{currentOrder.contractor.address}</p>}
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Order Reference</span>
                    <p className="font-mono text-xl font-bold text-slate-900">{currentOrder.orderNumber}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Date: {new Date(currentOrder.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Client / Location Info */}
                <div className="bg-slate-50 p-4 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Client Details
                    </span>
                    <p className="font-semibold text-slate-900">{currentOrder.clientName}</p>
                    {currentOrder.clientEmail && <p className="text-slate-600">{currentOrder.clientEmail}</p>}
                    {currentOrder.clientPhone && <p className="text-slate-600">{currentOrder.clientPhone}</p>}
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
                      Service Location
                    </span>
                    <p className="text-slate-700">{currentOrder.clientAddress || 'Not specified'}</p>
                  </div>
                </div>

                {/* Scope of Work Table */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Work Specification</h3>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 font-semibold text-xs uppercase">
                        <th className="py-2">Description</th>
                        <th className="py-2 text-center w-16">Qty</th>
                        <th className="py-2 text-right w-24">Price</th>
                        <th className="py-2 text-right w-28">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentOrder.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-3 text-slate-800">{item.description || 'Standard Scope Item'}</td>
                          <td className="py-3 text-center text-slate-600">{item.quantity}</td>
                          <td className="py-3 text-right text-slate-600">${Number(item.unitPrice).toFixed(2)}</td>
                          <td className="py-3 text-right font-semibold text-slate-900">
                            ${(item.quantity * item.unitPrice).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="flex justify-end pt-4 border-t border-slate-200 mt-2">
                    <div className="text-right">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Agreed Balance</span>
                      <p className="text-3xl font-black text-slate-900">${currentOrder.totalAmount.toFixed(2)}</p>
                    </div>
                  </div>
                </div>

                {/* Notes & Terms */}
                {currentOrder.notes && (
                  <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-600 border border-slate-200">
                    <span className="font-bold uppercase tracking-wider text-slate-500 block mb-1">Terms & Notes</span>
                    {currentOrder.notes}
                  </div>
                )}

                {/* Signature Block */}
                <div className="border-t border-slate-200 pt-6">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Authorization & Acceptance
                  </h3>
                  
                  {currentOrder.signature ? (
                    <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-emerald-900">Document Electronically Signed</p>
                        <p className="text-xs text-emerald-700">
                          Signer: {currentOrder.signature} • Timestamp: {new Date(currentOrder.signedAt || '').toLocaleString()}
                        </p>
                      </div>
                      <span className="text-emerald-700 text-lg">✓</span>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          id="signerInput"
                          placeholder="Type your full legal name to sign"
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg font-serif italic text-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const input = document.getElementById('signerInput') as HTMLInputElement;
                            if (input && input.value.trim()) {
                              const typedSignature = input.value.trim();
                              setOrders((prev) =>
                                prev.map((ord) =>
                                  ord.id === currentOrder.id
                                    ? {
                                        ...ord,
                                        signature: typedSignature,
                                        signedAt: new Date().toISOString()
                                      }
                                    : ord
                                )
                              );
                            } else {
                              alert('Please type your name before accepting.');
                            }
                          }}
                          className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-sm transition"
                        >
                          Sign & Accept
                        </button>
                      </div>
                      <p className="text-xs text-slate-400">
                        By signing, you agree that this electronic signature is legally binding.
                      </p>
                    </div>
                  )}
                </div>

                {/* --- Guarded Instant Payment Section --- */}
                {/* Strictly hidden if enableInstantPayment is false. Clicking will not mark as PAID without contractor confirmation */}
                {currentOrder.enableInstantPayment && (
                  <div className="border-t border-slate-200 pt-6 mt-6 bg-amber-50/50 p-5 rounded-xl border border-amber-100">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">Instant Online Settlement</h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {currentOrder.paymentStatus === 'PAID'
                            ? 'Payment has been verified by the contractor.'
                            : 'Clicking below opens the payment gateway in a secure window.'}
                        </p>
                      </div>

                      {currentOrder.paymentStatus === 'PAID' ? (
                        <div className="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-lg uppercase tracking-wider">
                          ✓ Paid in Full
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            alert(
                              'Opening external checkout gateway. The order status remains unpaid until verified by the contractor or gateway webhook.'
                            );
                          }}
                          className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-lg transition shadow-sm"
                        >
                          Pay ${currentOrder.totalAmount.toFixed(2)} Online
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </main>
    </div>
  );
}
