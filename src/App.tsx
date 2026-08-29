import { useState, useEffect, useRef } from 'react';
import './index.css';

// --- CONFIGURATION: INSERT YOUR SUPABASE CREDENTIALS HERE ---
const SUPABASE_URL = 'https://dxlzlhoeujlpbrjpjrid.supabase.co';
const SUPABASE_KEY = 'sb_publishable_tv9skPRoecEhxxaMtLy0cw_5c14zay-';

interface Preset {
  label: string;
  cost: number;
  desc: string;
}

interface OrderRecord {
  id: string;
  order_type: string;
  contractor_company: string;
  project_title: string;
  client_name: string;
  client_phone: string;
  description: string;
  cost: number;
  status: string;
  payment_status?: string;
  payment_link?: string;
  photo_data?: string;
  signature_data?: string;
  signed_at?: string;
  created_at?: string;
}

interface ContractorProfile {
  companyName: string;
  licenseNumber: string;
  phone: string;
  email: string;
  logoDataUrl: string;
  customTerms: string;
  stripePaymentLink: string;
  requirePaymentUpfront: boolean;
}

const DEFAULT_TERMS =
  'The undersigned authorizes the contractor to execute the described modifications/services. All labor, equipment, and materials will be provided in accordance with the specified terms. Payment for authorized extra work becomes due upon completion or in accordance with original project milestones. Digital signatures captured here carry full legal binding authority under the Uniform Electronic Transactions Act (UETA).';

const PRESETS: Preset[] = [
  {
    label: 'Additional Coat of Paint',
    cost: 280,
    desc: 'Client requested extra coat of premium satin finish on living room walls.',
  },
  {
    label: 'Subfloor Drywall Patch',
    cost: 195,
    desc: 'Cut out damaged 2x2 section and install reinforced backing plate.',
  },
  {
    label: 'Add Dedicated Outlet',
    cost: 225,
    desc: 'Run 12/2 Romex line for kitchen island microwave outlet.',
  },
];

export default function App() {
  const [view, setView] = useState<
    'dashboard' | 'contractor' | 'client_review' | 'signed_receipt' | 'settings'
  >('dashboard');
  const [orderType, setOrderType] = useState<
    'Change Order' | 'New Job Estimate'
  >('Change Order');

  const [isClientMode, setIsClientMode] = useState<boolean>(false);
  const [filterTab, setFilterTab] = useState<
    'active' | 'pending' | 'signed' | 'archived'
  >('active');
  const [archivedOrderIds, setArchivedOrderIds] = useState<string[]>(() => {
    const saved = localStorage.getItem('fieldsign_archived_ids');
    return saved ? JSON.parse(saved) : [];
  });

  const [profile, setProfile] = useState<ContractorProfile>(() => {
    const saved = localStorage.getItem('fieldsign_contractor_profile');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {
      companyName: 'Apex Remodeling & Build',
      licenseNumber: 'GC-VA-89421A',
      phone: '(555) 728-1920',
      email: 'ops@apexremodel.com',
      logoDataUrl: '',
      customTerms: DEFAULT_TERMS,
      stripePaymentLink: 'https://buy.stripe.com/test_demo',
      requirePaymentUpfront: true,
    };
  });

  // Active Job Form State
  const [clientName, setClientName] = useState('Sarah Jenkins');
  const [clientPhone, setClientPhone] = useState('(555) 382-9102');
  const [projectTitle, setProjectTitle] = useState(
    'Oakwood Master Bath Remodel'
  );
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [orderPaymentLink, setOrderPaymentLink] = useState('');
  const [photoData, setPhotoData] = useState<string>(''); // Base64 job-site photo

  // Database & Active Order State
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signTimestamp, setSignTimestamp] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(true);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'paid'>(
    'unpaid'
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawing = useRef(false);
  const triggerNativeSms = (
    phone: string,
    name: string,
    project: string,
    amount: string | number,
    orderId?: string
  ) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const targetId = orderId || currentOrderId;
    const url = targetId
      ? `${window.location.origin}?id=${targetId}`
      : window.location.href;
    const bodyText = `Hi ${name}, please review and authorize the ${orderType} for "${project}" ($${amount}): ${url}`;
    window.location.href = `sms:${cleanPhone}?body=${encodeURIComponent(
      bodyText
    )}`;
  };

  const toggleArchiveOrder = (orderId: string) => {
    let updated: string[];
    if (archivedOrderIds.includes(orderId)) {
      updated = archivedOrderIds.filter((id) => id !== orderId);
    } else {
      updated = [...archivedOrderIds, orderId];
    }
    setArchivedOrderIds(updated);
    localStorage.setItem('fieldsign_archived_ids', JSON.stringify(updated));
  };

  const saveProfile = (newProfile: ContractorProfile) => {
    setProfile(newProfile);
    localStorage.setItem(
      'fieldsign_contractor_profile',
      JSON.stringify(newProfile)
    );
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        saveProfile({ ...profile, logoDataUrl: reader.result as string });
      };
      reader.readAsDataURL(file);
    }
  };

  // Compress & attach site photo
  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Resize image slightly so saving to Postgres remains fast & compact
          const canvas = document.createElement('canvas');
          const maxDim = 800;
          let width = img.width;
          let height = img.height;
          if (width > height && width > maxDim) {
            height *= maxDim / width;
            width = maxDim;
          } else if (height > maxDim) {
            width *= maxDim / height;
            height = maxDim;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          setPhotoData(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderIdParam = params.get('id');
    if (orderIdParam) {
      setIsClientMode(true);
      loadOrderFromDb(orderIdParam);
    } else {
      setIsClientMode(false);
      fetchDashboardOrders();
    }
  }, []);

  const fetchDashboardOrders = async () => {
    setIsLoadingOrders(true);
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const data = await response.json();
      if (Array.isArray(data)) {
        setOrders(data);
      }
    } catch (err) {
      console.error('Error fetching dashboard orders:', err);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const loadOrderFromDb = async (orderId: string) => {
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=*`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const o = data[0];
        setCurrentOrderId(o.id);
        setOrderType(o.order_type || 'Change Order');
        setProjectTitle(o.project_title);
        setClientName(o.client_name);
        setClientPhone(o.client_phone);
        setDescription(o.description);
        setCost(o.cost.toString());
        setPhotoData(o.photo_data || '');
        setPaymentStatus(o.payment_status || 'unpaid');
        setOrderPaymentLink(o.payment_link || profile.stripePaymentLink);

        if (o.status === 'signed') {
          setSignatureData(o.signature_data);
          setSignTimestamp(o.signed_at);
          setView('signed_receipt');
        } else {
          setView('client_review');
        }
      }
    } catch (err) {
      console.error('Error fetching order:', err);
    }
  };

  const applyPreset = (preset: Preset) => {
    setDescription(preset.desc);
    setCost(preset.cost.toString());
  };

  const createOrder = async () => {
    if (!description || !cost) {
      alert('Please fill out the scope description and cost.');
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          order_type: orderType,
          contractor_company: profile.companyName,
          project_title: projectTitle,
          client_name: clientName,
          client_phone: clientPhone,
          description: description,
          cost: parseFloat(cost) || 0,
          status: 'pending',
          photo_data: photoData || null,
          payment_status: 'unpaid',
          payment_link: profile.stripePaymentLink,
        }),
      });

      const data = await response.json();
      if (data && data.length > 0) {
        const savedOrder = data[0];
        setCurrentOrderId(savedOrder.id);
        setOrderPaymentLink(profile.stripePaymentLink);
        await fetchDashboardOrders();
        setView('dashboard');
        triggerNativeSms(
          clientPhone,
          clientName,
          projectTitle,
          cost,
          savedOrder.id
        );
      }
    } catch (err) {
      console.error('Database save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    } else if (e.clientX !== undefined) {
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    return null;
  };

  const handleStartDraw = (e: any) => {
    isDrawing.current = true;
    const coords = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!coords || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
  };

  const handleDraw = (e: any) => {
    if (!isDrawing.current) return;
    const coords = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!coords || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };

  const handleStopDraw = () => {
    isDrawing.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
  const finalizeSignatureAndPay = async (openStripe: boolean = false) => {
    if (!acceptedTerms) {
      alert('Please accept the authorization terms before signing.');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const signature = canvas.toDataURL();
    const timestamp = new Date().toLocaleString();
    setSignatureData(signature);
    setSignTimestamp(timestamp);

    if (currentOrderId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${currentOrderId}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'signed',
            payment_status: openStripe ? 'paid' : 'unpaid',
            signature_data: signature,
            signed_at: timestamp,
          }),
        });
        fetchDashboardOrders();
      } catch (err) {
        console.error('Error recording signature:', err);
      }
    }

    if (openStripe && (orderPaymentLink || profile.stripePaymentLink)) {
      window.open(orderPaymentLink || profile.stripePaymentLink, '_blank');
      setPaymentStatus('paid');
    }

    setView('signed_receipt');
  };

  const handleDownloadPdf = (targetDoc?: {
    company: string;
    type: string;
    project: string;
    client: string;
    phone: string;
    desc: string;
    amount: string | number;
    sig?: string;
    date?: string;
    docId?: string;
    isPaid?: boolean;
    photo?: string;
  }) => {
    const { jsPDF } = (window as any).jspdf || {};
    if (!jsPDF) {
      alert('PDF library is loading. Please try again in 2 seconds.');
      return;
    }

    const dCompany = targetDoc?.company || profile.companyName;
    const dType = targetDoc?.type || orderType;
    const dProject = targetDoc?.project || projectTitle;
    const dClient = targetDoc?.client || clientName;
    const dPhone = targetDoc?.phone || clientPhone;
    const dDesc = targetDoc?.desc || description;
    const dCost = targetDoc?.amount || cost;
    const dSig = targetDoc?.sig || signatureData;
    const dPhoto = targetDoc?.photo || photoData;
    const dTimestamp = targetDoc?.date || signTimestamp;
    const dId = targetDoc?.docId || currentOrderId;
    const dPaid =
      targetDoc?.isPaid !== undefined
        ? targetDoc.isPaid
        : paymentStatus === 'paid';

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter',
    });
    const primaryColor = [15, 23, 42];
    const accentColor = [245, 158, 11];
    const grayText = [100, 116, 139];

    // Top Accent Bar
    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, 612, 10, 'F');

    let textLeftMargin = 40;
    if (profile.logoDataUrl) {
      try {
        doc.addImage(profile.logoDataUrl, 'JPEG', 40, 26, 45, 45);
        textLeftMargin = 95;
      } catch (e) {
        textLeftMargin = 40;
      }
    }

    // Company Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(dCompany.toUpperCase(), textLeftMargin, 42);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(
      `License: ${profile.licenseNumber || 'N/A'}  •  Phone: ${
        profile.phone
      }  •  ${profile.email}`,
      textLeftMargin,
      56
    );
    doc.text(
      'OFFICIAL WORK AUTHORIZATION & PAYMENT RECORD',
      textLeftMargin,
      68
    );

    // Badge
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.roundedRect(420, 30, 152, 26, 4, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(dType.toUpperCase(), 496, 47, { align: 'center' });

    // Divider
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(40, 80, 572, 80);

    // Project Details Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, 92, 258, 70, 6, 6, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 92, 258, 70, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('PROJECT DETAILS', 52, 108);

    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(`Project: ${dProject}`, 52, 124);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(
      `Doc Ref: ${
        dId ? dId.slice(0, 8) : 'RECORDED'
      }  •  Date: ${new Date().toLocaleDateString()}`,
      52,
      140
    );

    // Client Details Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(314, 92, 258, 70, 6, 6, 'F');
    doc.roundedRect(314, 92, 258, 70, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('CLIENT & SETTLEMENT', 326, 108);

    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(`Client: ${dClient}`, 326, 124);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(
      `Phone: ${dPhone}  •  Status: ${dPaid ? 'Paid' : 'Authorized'}`,
      326,
      140
    );

    // Scope & Photo Box
    const scopeBoxHeight = dPhoto ? 160 : 120;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, 172, 532, scopeBoxHeight, 6, 6, 'F');
    doc.roundedRect(40, 172, 532, scopeBoxHeight, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('AUTHORIZED SCOPE & SITE EVIDENCE', 52, 190);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);

    if (dPhoto) {
      // Text on left, Photo on right
      const splitDesc = doc.splitTextToSize(
        dDesc || 'Scope authorization recorded.',
        340
      );
      doc.text(splitDesc, 52, 206);
      try {
        doc.addImage(dPhoto, 'JPEG', 410, 185, 145, 135);
      } catch (e) {
        console.error('Photo render error:', e);
      }
    } else {
      const splitDesc = doc.splitTextToSize(
        dDesc || 'Scope authorization recorded.',
        508
      );
      doc.text(splitDesc, 52, 206);
    }

    // Cost Block
    const costY = 172 + scopeBoxHeight + 12;
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.roundedRect(40, costY, 532, 42, 6, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('TOTAL AUTHORIZED ADJUSTMENT:', 56, costY + 26);

    doc.setFontSize(16);
    doc.setTextColor(251, 191, 36);
    doc.text(`$${dCost || '0.00'} USD`, 556, costY + 27, { align: 'right' });

    // Terms Box
    const termsY = costY + 52;
    doc.setFillColor(254, 252, 232);
    doc.roundedRect(40, termsY, 532, 48, 4, 4, 'F');
    doc.setDrawColor(254, 240, 138);
    doc.roundedRect(40, termsY, 532, 48, 4, 4, 'D');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('LEGAL AUTHORIZATION & PAYMENT TERMS:', 50, termsY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(113, 63, 18);
    const legalNotice = profile.customTerms || DEFAULT_TERMS;
    doc.text(doc.splitTextToSize(legalNotice, 512), 50, termsY + 24);

    // Signature Block
    const sigY = termsY + 58;
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(40, sigY, 532, 85, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('AUTHORIZED ELECTRONIC CLIENT SIGNATURE', 52, sigY + 15);

    if (dSig) {
      try {
        doc.addImage(dSig, 'PNG', 52, sigY + 20, 220, 50);
      } catch (e) {
        console.error('Signature render error:', e);
      }
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(
      `Timestamp: ${dTimestamp || new Date().toLocaleString()}`,
      350,
      sigY + 40
    );
    doc.text(
      `Status: ${dPaid ? 'Authorized & Direct Paid' : 'Authorized Sign-Off'}`,
      350,
      sigY + 55
    );

    const pdfBlob = doc.output('blob');
    const blobUrl = URL.createObjectURL(pdfBlob);
    window.open(blobUrl, '_blank');
  };

  const displayedOrders = orders.filter((o) => {
    const isArchived = archivedOrderIds.includes(o.id);
    if (filterTab === 'archived') return isArchived;
    if (isArchived) return false;
    if (filterTab === 'pending') return o.status === 'pending';
    if (filterTab === 'signed') return o.status === 'signed';
    return true;
  });

  const totalApprovedRevenue = orders
    .filter((o) => o.status === 'signed' && !archivedOrderIds.includes(o.id))
    .reduce((sum, o) => sum + (Number(o.cost) || 0), 0);
  const totalPaidRevenue = orders
    .filter(
      (o) => o.payment_status === 'paid' && !archivedOrderIds.includes(o.id)
    )
    .reduce((sum, o) => sum + (Number(o.cost) || 0), 0);
  const signedCount = orders.filter(
    (o) => o.status === 'signed' && !archivedOrderIds.includes(o.id)
  ).length;
  const pendingCount = orders.filter(
    (o) => o.status === 'pending' && !archivedOrderIds.includes(o.id)
  ).length;

  return (
    <div className="app-container">
      {!isClientMode && (
        <div className="demo-banner">
          <span>⚡ FieldSign Contractor Portal</span>
          <div className="demo-btn-group">
            <button
              type="button"
              onClick={() => {
                fetchDashboardOrders();
                setView('dashboard');
              }}
              className={`demo-btn ${view === 'dashboard' ? 'active' : ''}`}
            >
              📊 Dashboard
            </button>
            <button
              type="button"
              onClick={() => {
                setDescription('');
                setCost('');
                setPhotoData('');
                setCurrentOrderId(null);
                setView('contractor');
              }}
              className={`demo-btn ${view === 'contractor' ? 'active' : ''}`}
            >
              + New Order
            </button>
            <button
              type="button"
              onClick={() => setView('settings')}
              className={`demo-btn ${view === 'settings' ? 'active' : ''}`}
            >
              ⚙️ Setup
            </button>
          </div>
        </div>
      )}

      <div className="main-wrapper">
        {/* VIEW 4: SETTINGS */}
        {view === 'settings' && !isClientMode && (
          <div className="card-dark">
            <div className="card-header">
              <div>
                <span className="sub-tag">Payments & Profile</span>
                <h2 className="card-title">Settings & Branding</h2>
              </div>
              <span style={{ fontSize: '24px' }}>⚙️</span>
            </div>

            <div
              style={{
                background: '#0b1120',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '16px',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#38bdf8',
                  textTransform: 'uppercase',
                }}
              >
                Stripe Payment Link
              </span>
              <p
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  margin: '4px 0 10px 0',
                }}
              >
                Paste your Stripe Payment Link.
              </p>
              <input
                type="text"
                value={profile.stripePaymentLink}
                onChange={(e) =>
                  saveProfile({ ...profile, stripePaymentLink: e.target.value })
                }
                placeholder="https://buy.stripe.com/..."
              />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '10px',
                }}
              >
                <input
                  type="checkbox"
                  id="requirePayment"
                  checked={profile.requirePaymentUpfront}
                  onChange={(e) =>
                    saveProfile({
                      ...profile,
                      requirePaymentUpfront: e.target.checked,
                    })
                  }
                  style={{
                    width: '16px',
                    height: '16px',
                    accentColor: '#f59e0b',
                  }}
                />
                <label
                  htmlFor="requirePayment"
                  style={{
                    fontSize: '12px',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  Enable Instant Payment Button on signing screen
                </label>
              </div>
            </div>

            <div
              className="form-group"
              style={{
                textAlign: 'center',
                background: '#0b1120',
                padding: '16px',
                borderRadius: '12px',
                border: '1px solid #1e293b',
              }}
            >
              <label className="form-label">Company Logo</label>
              {profile.logoDataUrl ? (
                <div style={{ margin: '10px 0' }}>
                  <img
                    src={profile.logoDataUrl}
                    alt="Logo"
                    style={{
                      maxHeight: '60px',
                      margin: '0 auto',
                      borderRadius: '6px',
                    }}
                  />
                  <br />
                  <button
                    type="button"
                    onClick={() => saveProfile({ ...profile, logoDataUrl: '' })}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '11px',
                      cursor: 'pointer',
                      marginTop: '6px',
                    }}
                  >
                    ✕ Remove Logo
                  </button>
                </div>
              ) : (
                <p
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    margin: '8px 0',
                  }}
                >
                  No logo uploaded yet
                </p>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{
                  fontSize: '12px',
                  border: 'none',
                  background: 'transparent',
                }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Business / Contractor Name</label>
              <input
                type="text"
                value={profile.companyName}
                onChange={(e) =>
                  saveProfile({ ...profile, companyName: e.target.value })
                }
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">License / Reg #</label>
                <input
                  type="text"
                  value={profile.licenseNumber}
                  onChange={(e) =>
                    saveProfile({ ...profile, licenseNumber: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">Office Phone</label>
                <input
                  type="text"
                  value={profile.phone}
                  onChange={(e) =>
                    saveProfile({ ...profile, phone: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Business Email</label>
              <input
                type="text"
                value={profile.email}
                onChange={(e) =>
                  saveProfile({ ...profile, email: e.target.value })
                }
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Custom Legal Authorization Terms
              </label>
              <textarea
                rows={3}
                value={profile.customTerms}
                onChange={(e) =>
                  saveProfile({ ...profile, customTerms: e.target.value })
                }
              />
            </div>

            <button
              type="button"
              onClick={() => {
                alert('Settings Saved!');
                setView('dashboard');
              }}
              className="btn-primary"
            >
              ✓ Save Settings & Return
            </button>
          </div>
        )}

        {/* VIEW 0: CONTRACTOR DASHBOARD */}
        {view === 'dashboard' && !isClientMode && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  background: '#131b2e',
                  border: '1px solid #1e293b',
                  borderRadius: '14px',
                  padding: '14px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  Approved Volume
                </span>
                <h3
                  style={{
                    fontSize: '22px',
                    fontWeight: 900,
                    color: '#10b981',
                    marginTop: '2px',
                  }}
                >
                  ${totalApprovedRevenue.toLocaleString()}
                </h3>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {signedCount} signed orders
                </span>
              </div>

              <div
                style={{
                  background: '#131b2e',
                  border: '1px solid #1e293b',
                  borderRadius: '14px',
                  padding: '14px',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  Direct Paid (Stripe)
                </span>
                <h3
                  style={{
                    fontSize: '22px',
                    fontWeight: 900,
                    color: '#38bdf8',
                    marginTop: '2px',
                  }}
                >
                  ${totalPaidRevenue.toLocaleString()}
                </h3>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {pendingCount} pending signature
                </span>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                gap: '6px',
                marginBottom: '14px',
                overflowX: 'auto',
                paddingBottom: '2px',
              }}
            >
              <button
                type="button"
                onClick={() => setFilterTab('active')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'active' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'active' ? '#0f172a' : '#94a3b8',
                }}
              >
                All Active (
                {orders.filter((o) => !archivedOrderIds.includes(o.id)).length})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('pending')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'pending' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'pending' ? '#0f172a' : '#94a3b8',
                }}
              >
                ⏳ Pending ({pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('signed')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'signed' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'signed' ? '#0f172a' : '#94a3b8',
                }}
              >
                ✓ Signed ({signedCount})
              </button>
              <button
                type="button"
                onClick={() => setFilterTab('archived')}
                style={{
                  padding: '6px 12px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'archived' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'archived' ? '#0f172a' : '#94a3b8',
                }}
              >
                📁 Hidden ({archivedOrderIds.length})
              </button>
            </div>

            {displayedOrders.length === 0 && !isLoadingOrders && (
              <div
                className="card-dark"
                style={{ textAlign: 'center', padding: '36px 16px' }}
              >
                <span style={{ fontSize: '32px' }}>📝</span>
                <h4
                  style={{
                    fontSize: '15px',
                    fontWeight: 700,
                    marginTop: '8px',
                  }}
                >
                  No orders in this view
                </h4>
                <p
                  style={{
                    fontSize: '12px',
                    color: '#94a3b8',
                    marginTop: '4px',
                  }}
                >
                  {filterTab === 'archived'
                    ? 'No orders have been hidden yet.'
                    : 'All caught up! Create a new order to get started.'}
                </p>
              </div>
            )}

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              {displayedOrders.map((o) => (
                <div
                  key={o.id}
                  style={{
                    background: '#131b2e',
                    border: '1px solid #1e293b',
                    borderRadius: '14px',
                    padding: '14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '6px',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          fontSize: '10px',
                          fontWeight: 800,
                          color: '#f59e0b',
                          textTransform: 'uppercase',
                        }}
                      >
                        {o.order_type || 'Change Order'}
                      </span>
                      <h4
                        style={{
                          fontSize: '15px',
                          fontWeight: 800,
                          marginTop: '1px',
                        }}
                      >
                        {o.project_title}
                      </h4>
                      <p style={{ fontSize: '12px', color: '#94a3b8' }}>
                        Client: <strong>{o.client_name}</strong> (
                        {o.client_phone})
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: '16px',
                          fontWeight: 900,
                          color: o.status === 'signed' ? '#10b981' : '#f1f5f9',
                        }}
                      >
                        ${o.cost}
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          gap: '4px',
                          justifyContent: 'flex-end',
                          marginTop: '4px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '8px',
                            background:
                              o.status === 'signed'
                                ? 'rgba(16, 185, 129, 0.15)'
                                : 'rgba(245, 158, 11, 0.15)',
                            color:
                              o.status === 'signed' ? '#10b981' : '#f59e0b',
                          }}
                        >
                          {o.status === 'signed' ? '✓ Signed' : '⏳ Pending'}
                        </span>
                        {o.payment_status === 'paid' && (
                          <span
                            style={{
                              fontSize: '9px',
                              fontWeight: 800,
                              padding: '2px 6px',
                              borderRadius: '8px',
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                            }}
                          >
                            💳 Paid
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <p
                    style={{
                      fontSize: '12px',
                      color: '#cbd5e1',
                      background: '#0b1120',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      margin: '8px 0',
                    }}
                  >
                    {o.description}
                  </p>

                  <div
                    style={{ display: 'flex', gap: '6px', marginTop: '10px' }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        triggerNativeSms(
                          o.client_phone,
                          o.client_name,
                          o.project_title,
                          o.cost,
                          o.id
                        )
                      }
                      style={{
                        flex: 1.2,
                        padding: '8px',
                        borderRadius: '8px',
                        border: '1px solid #10b981',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        fontSize: '11px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      💬 Text SMS
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const directUrl = `${window.location.origin}?id=${o.id}`;
                        navigator.clipboard.writeText(directUrl);
                        alert(`Sign link copied for ${o.client_name}!`);
                      }}
                      style={{
                        flex: 1,
                        padding: '8px',
                        borderRadius: '8px',
                        border: '1px solid #334155',
                        background: '#1e293b',
                        color: '#38bdf8',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      📋 Copy Link
                    </button>

                    {o.status === 'signed' && (
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadPdf({
                            company: o.contractor_company,
                            type: o.order_type,
                            project: o.project_title,
                            client: o.client_name,
                            phone: o.client_phone,
                            desc: o.description,
                            amount: o.cost,
                            photo: o.photo_data,
                            sig: o.signature_data,
                            date: o.signed_at,
                            docId: o.id,
                            isPaid: o.payment_status === 'paid',
                          })
                        }
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '8px',
                          border: 'none',
                          background: '#10b981',
                          color: '#ffffff',
                          fontSize: '11px',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        📄 Open PDF
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleArchiveOrder(o.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        border: '1px solid #334155',
                        background: '#0b1120',
                        color: '#94a3b8',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title={
                        archivedOrderIds.includes(o.id)
                          ? 'Unhide'
                          : 'Hide / Archive'
                      }
                    >
                      {archivedOrderIds.includes(o.id) ? 'Unhide' : '✕ Hide'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* VIEW 1: CONTRACTOR FORM WITH PHOTO CAPTURE */}
        {view === 'contractor' && !isClientMode && (
          <div className="card-dark">
            <div
              style={{
                display: 'flex',
                background: '#0b1120',
                padding: '4px',
                borderRadius: '10px',
                marginBottom: '16px',
                border: '1px solid #1e293b',
              }}
            >
              <button
                type="button"
                onClick={() => setOrderType('Change Order')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background:
                    orderType === 'Change Order' ? '#f59e0b' : 'transparent',
                  color: orderType === 'Change Order' ? '#0f172a' : '#94a3b8',
                }}
              >
                Scope Change (Add-on)
              </button>
              <button
                type="button"
                onClick={() => setOrderType('New Job Estimate')}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background:
                    orderType === 'New Job Estimate'
                      ? '#f59e0b'
                      : 'transparent',
                  color:
                    orderType === 'New Job Estimate' ? '#0f172a' : '#94a3b8',
                }}
              >
                New Job Agreement
              </button>
            </div>

            <div className="card-header">
              <div>
                <span className="sub-tag">{profile.companyName}</span>
                <h2 className="card-title">
                  {orderType === 'Change Order'
                    ? 'Quick Change Order'
                    : 'Quick Estimate'}
                </h2>
              </div>
              <span style={{ fontSize: '24px' }}>📋</span>
            </div>

            {orderType === 'Change Order' && (
              <>
                <label className="form-label">Tap to Auto-Fill Template:</label>
                <div className="presets-grid">
                  {PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="preset-chip"
                    >
                      +{p.label} (${p.cost})
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Client Name</label>
                <input
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Client Phone (for SMS)</label>
                <input
                  type="text"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Project / Job Name</label>
              <input
                type="text"
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Scope Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe labor, materials, or adjustments..."
              />
            </div>

            {/* 📷 Job-Site Photo Attachment Box */}
            <div
              style={{
                background: '#0b1120',
                border: '1px dashed #334155',
                borderRadius: '12px',
                padding: '12px',
                marginBottom: '14px',
                textAlign: 'center',
              }}
            >
              <label
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#38bdf8',
                  textTransform: 'uppercase',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                📷 Job-Site Evidence Photo (Optional)
              </label>
              {photoData ? (
                <div style={{ margin: '8px 0' }}>
                  <img
                    src={photoData}
                    alt="Site Condition"
                    style={{
                      maxHeight: '110px',
                      margin: '0 auto',
                      borderRadius: '8px',
                      border: '1px solid #334155',
                    }}
                  />
                  <br />
                  <button
                    type="button"
                    onClick={() => setPhotoData('')}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      fontSize: '11px',
                      cursor: 'pointer',
                      marginTop: '6px',
                    }}
                  >
                    ✕ Remove Photo
                  </button>
                </div>
              ) : (
                <p
                  style={{
                    fontSize: '11px',
                    color: '#64748b',
                    margin: '4px 0 8px 0',
                  }}
                >
                  Snap a photo of the unexpected condition or materials needed
                </p>
              )}
              <input
                type="file"
                accept="image/*"
                capture="environment" // Triggers rear camera directly on phones
                onChange={handlePhotoCapture}
                style={{ fontSize: '11px', color: '#94a3b8' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Authorized Amount ($ USD)</label>
              <input
                type="number"
                className="price-input"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="0.00"
              />
            </div>

            <button
              type="button"
              onClick={createOrder}
              disabled={isSaving}
              className="btn-primary"
            >
              {isSaving
                ? 'Saving to Database...'
                : '🚀 Save & Text Link to Client'}
            </button>
          </div>
        )}

        {/* VIEW 2: CLIENT SIGN-OFF WITH EVIDENCE PREVIEW */}
        {view === 'client_review' && (
          <div className="card-light">
            <div className="card-header">
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                {profile.logoDataUrl && (
                  <img
                    src={profile.logoDataUrl}
                    alt="Logo"
                    style={{ maxHeight: '35px', borderRadius: '4px' }}
                  />
                )}
                <div>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 800,
                      color: '#d97706',
                      textTransform: 'uppercase',
                    }}
                  >
                    {profile.companyName}
                  </span>
                  <h3
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      marginTop: '2px',
                    }}
                  >
                    {orderType} Authorization
                  </h3>
                </div>
              </div>
              <span
                style={{
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '12px',
                  fontWeight: 700,
                }}
              >
                Pending Sign-off
              </span>
            </div>

            <div className="summary-box">
              <div className="summary-row">
                <span>Project:</span>
                <strong>{projectTitle}</strong>
              </div>
              <div className="summary-row">
                <span>Client:</span>
                <strong>{clientName}</strong>
              </div>
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#64748b',
                    textTransform: 'uppercase',
                  }}
                >
                  Agreed Scope:
                </span>
                <p
                  style={{
                    marginTop: '4px',
                    color: '#1e293b',
                    fontWeight: 500,
                  }}
                >
                  {description || 'Scope work details.'}
                </p>
              </div>

              {/* Photo Evidence on Client Screen */}
              {photoData && (
                <div
                  style={{
                    marginTop: '8px',
                    paddingTop: '8px',
                    borderTop: '1px solid #e2e8f0',
                    textAlign: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 800,
                      color: '#64748b',
                      textTransform: 'uppercase',
                      display: 'block',
                      marginBottom: '6px',
                    }}
                  >
                    On-Site Evidence Photo:
                  </span>
                  <img
                    src={photoData}
                    alt="Job Condition"
                    style={{
                      maxHeight: '140px',
                      margin: '0 auto',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
              )}

              <div className="summary-total">
                <span>Authorized Total:</span>
                <span>${cost || '0.00'}</span>
              </div>
            </div>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '10px 12px',
                marginBottom: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                }}
              >
                <input
                  type="checkbox"
                  id="legalAgree"
                  checked={acceptedTerms}
                  onChange={(e) => setAcceptedTerms(e.target.checked)}
                  style={{
                    width: '16px',
                    height: '16px',
                    marginTop: '2px',
                    accentColor: '#f59e0b',
                    cursor: 'pointer',
                  }}
                />
                <label
                  htmlFor="legalAgree"
                  style={{
                    fontSize: '11px',
                    color: '#475569',
                    lineHeight: '1.4',
                    cursor: 'pointer',
                  }}
                >
                  <strong>Authorization & Terms:</strong> {profile.customTerms}
                </label>
              </div>
            </div>

            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <label
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: '#334155',
                  }}
                >
                  Sign with finger or mouse:
                </label>
                <button
                  type="button"
                  onClick={clearCanvas}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    cursor: 'pointer',
                    fontSize: '11px',
                  }}
                >
                  ↺ Clear
                </button>
              </div>

              <div className="canvas-wrapper">
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={120}
                  onMouseDown={handleStartDraw}
                  onMouseMove={handleDraw}
                  onMouseUp={handleStopDraw}
                  onTouchStart={handleStartDraw}
                  onTouchMove={handleDraw}
                  onTouchEnd={handleStopDraw}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              {profile.requirePaymentUpfront &&
                (profile.stripePaymentLink || orderPaymentLink) && (
                  <button
                    type="button"
                    onClick={() => finalizeSignatureAndPay(true)}
                    disabled={!acceptedTerms}
                    style={{
                      width: '100%',
                      background: '#0f172a',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '12px',
                      padding: '14px',
                      fontSize: '15px',
                      fontWeight: 800,
                      cursor: acceptedTerms ? 'pointer' : 'not-allowed',
                      opacity: acceptedTerms ? 1 : 0.6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                    }}
                  >
                    💳 Sign & Pay Now with Stripe (${cost || '0.00'})
                  </button>
                )}

              <button
                type="button"
                onClick={() => finalizeSignatureAndPay(false)}
                disabled={!acceptedTerms}
                className="btn-approve"
                style={{
                  opacity: acceptedTerms ? 1 : 0.6,
                  cursor: acceptedTerms ? 'pointer' : 'not-allowed',
                  marginTop: 0,
                }}
              >
                ✓ Authorize Scope (Pay Later / On Invoice)
              </button>
            </div>
          </div>
        )}

        {/* VIEW 3: LOCKED RECEIPT */}
        {view === 'signed_receipt' && (
          <div className="card-dark" style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.15)',
                color: '#10b981',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px auto',
                fontSize: '20px',
                fontWeight: 800,
              }}
            >
              ✓
            </div>

            <h2 style={{ fontSize: '18px', fontWeight: 800 }}>
              Document Authorized & Locked
            </h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              {paymentStatus === 'paid'
                ? 'Payment processed & record archived.'
                : 'Permanent record saved in database.'}
            </p>

            <div
              style={{
                background: '#0b1120',
                borderRadius: '12px',
                padding: '14px',
                margin: '16px 0',
                textAlign: 'left',
                border: '1px solid #1e293b',
                fontSize: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: '#64748b' }}>Type:</span>
                <strong>{orderType}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: '#64748b' }}>Contractor:</span>
                <strong>{profile.companyName}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: '#64748b' }}>Client:</span>
                <strong>{clientName}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: '#64748b' }}>Amount:</span>
                <strong style={{ color: '#34d399' }}>${cost}</strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '6px',
                }}
              >
                <span style={{ color: '#64748b' }}>Payment:</span>
                <strong
                  style={{
                    color: paymentStatus === 'paid' ? '#38bdf8' : '#f59e0b',
                  }}
                >
                  {paymentStatus === 'paid'
                    ? 'Paid via Stripe'
                    : 'Invoice Due Upon Completion'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Timestamp:</span>
                <span style={{ fontFamily: 'monospace' }}>{signTimestamp}</span>
              </div>
              {signatureData && (
                <div
                  style={{
                    marginTop: '10px',
                    paddingTop: '8px',
                    borderTop: '1px solid #1e293b',
                  }}
                >
                  <span
                    style={{
                      color: '#64748b',
                      display: 'block',
                      marginBottom: '4px',
                    }}
                  >
                    Captured Signature:
                  </span>
                  <div
                    style={{
                      background: '#ffffff',
                      borderRadius: '8px',
                      padding: '6px',
                      textAlign: 'center',
                    }}
                  >
                    <img
                      src={signatureData}
                      alt="Client Signature"
                      style={{ maxHeight: '45px' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '12px',
              }}
            >
              <button
                type="button"
                onClick={() => handleDownloadPdf()}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  background: '#f59e0b',
                  color: '#0f172a',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                📄 Open / Download Official 1-Page PDF
              </button>

              {!isClientMode && (
                <button
                  type="button"
                  onClick={() => {
                    fetchDashboardOrders();
                    setView('dashboard');
                  }}
                  className="btn-secondary"
                >
                  ← Return to Dashboard
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
