import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import './index.css';
import { AuthScreen } from './components/AuthScreen';
import { supabase } from './lib/supabase';
import {
  AudioLines,
  ChevronDown,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react';
type OrderStatus =
  | 'draft'
  | 'pending'
  | 'changes_requested'
  | 'declined'
  | 'signed';

const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; color: string; background: string }
> = {
  draft: {
    label: '✎ Draft',
    color: '#cbd5e1',
    background: 'rgba(148, 163, 184, 0.15)'
  },
  pending: {
    label: '⏳ Awaiting Client',
    color: '#f59e0b',
    background: 'rgba(245, 158, 11, 0.15)'
  },
  changes_requested: {
    label: '⚠ Changes Requested',
    color: '#38bdf8',
    background: 'rgba(56, 189, 248, 0.15)'
  },
  declined: {
    label: '× Declined',
    color: '#f87171',
    background: 'rgba(239, 68, 68, 0.15)'
  },
  signed: {
    label: '✓ Signed',
    color: '#10b981',
    background: 'rgba(16, 185, 129, 0.15)'
  }
};

interface OrderRecord {
  id: string;
  order_type: string;
  contractor_company: string;
  contractor_logo?: string;
  contractor_license?: string;
  contractor_phone?: string;
  contractor_email?: string;
  custom_terms?: string;
  project_title: string;
  client_name: string;
  client_phone: string;
  description: string;
  cost: number;
  status: OrderStatus;
revision_number?: number;
client_response_note?: string;
client_responded_at?: string;
last_sent_at?: string;
  payment_status?: string;
  require_payment_upfront?: boolean;
  payments_enabled?: boolean;
  signing_token?: string;
  photo_data?: string;
  photo_data_2?: string;
  signature_data?: string;
  signed_at?: string;
  signed_at_utc?: string;
  signer_name?: string;
  created_at?: string;
}

interface ContractorProfile {
  companyName: string;
  licenseNumber: string;
  phone: string;
  email: string;
  logoDataUrl: string;
  customTerms: string;
  requirePaymentUpfront: boolean;
  stripeAccountId: string;
  stripeChargesEnabled: boolean;
  stripeDetailsSubmitted: boolean;
}

const DEFAULT_TERMS = "The undersigned authorizes the contractor to perform the modifications or services described above. Labor, equipment, and materials will be provided in accordance with the stated scope and payment terms. By checking the consent box and signing, the signer confirms their intent to authorize this electronic record and agrees to receive and retain it electronically.";
const CONSENT_TEXT = 'I agree to conduct this transaction electronically, confirm that I reviewed the scope and amount, and intend my electronic signature to authorize this record.';


export default function App() {
  const [view, setView] = useState<'dashboard' | 'contractor' | 'client_review' | 'signed_receipt' | 'settings'>('dashboard');
  const [orderType, setOrderType] = useState<'Change Order' | 'New Job Agreement'>('Change Order');
  
  const [isClientMode, setIsClientMode] = useState<boolean>(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [clientLoadError, setClientLoadError] = useState('');
  const [filterTab, setFilterTab] = useState<'active' | 'pending' | 'signed' | null>('active');

  const [profile, setProfile] = useState<ContractorProfile>(() => {
    const saved = localStorage.getItem('fieldsign_contractor_profile');
    if (saved) {
      try { return JSON.parse(saved); } catch {}
    }
    return {
      companyName: 'FieldSign',
      licenseNumber: 'FS-VA-00000',
      phone: '(000) 000-0000',
      email: 'info@fieldsign.com',
      logoDataUrl: '',
      customTerms: DEFAULT_TERMS,
      requirePaymentUpfront: false,
      stripeAccountId: '',
      stripeChargesEnabled: false,
      stripeDetailsSubmitted: false
    };
  });

  // Active Job Form State
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [photoData1, setPhotoData1] = useState<string>('');
  const [photoData2, setPhotoData2] = useState<string>('');
  
  // Active Bound Contractor Metadata for loaded orders
  const [orderContractorName, setOrderContractorName] = useState('');
  const [orderContractorLogo, setOrderContractorLogo] = useState('');
  const [orderContractorLicense, setOrderContractorLicense] = useState('');
  const [orderContractorPhone, setOrderContractorPhone] = useState('');
  const [orderContractorEmail, setOrderContractorEmail] = useState('');
  const [orderTerms, setOrderTerms] = useState('');
  const [orderRequirePaymentUpfront, setOrderRequirePaymentUpfront] = useState(false);
  const [orderPaymentsEnabled, setOrderPaymentsEnabled] = useState(false);
  const [isConnectingStripe, setIsConnectingStripe] = useState(false);

  // Speech Recognition Active Indicator
  const [activeListeningField, setActiveListeningField] = useState<string | null>(null);

  // Database & Active Order State
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [currentSigningToken, setCurrentSigningToken] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
const [revisionOpeningId, setRevisionOpeningId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signTimestamp, setSignTimestamp] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState<boolean>(false);
  const [signerName, setSignerName] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded'>('unpaid');
  const [clientResponseMode, setClientResponseMode] = useState<
  'changes_requested' | 'declined' | null
>(null);

const [clientResponseNote, setClientResponseNote] = useState('');
const [isSubmittingClientResponse, setIsSubmittingClientResponse] =
  useState(false);

const [clientResponseSubmitted, setClientResponseSubmitted] = useState<
  'changes_requested' | 'declined' | null
>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const profileSaveInProgress = useRef(false);
  const orderSubmissionInProgress = useRef(false);
  const isDrawing = useRef(false);
  const handleTabToggle = (tab: 'active' | 'pending' | 'signed') => {
    setFilterTab(prev => prev === tab ? null : tab);
  };

  // Speech Recognition (Dictation) Engine
  const startDictation = (
  field: string,
  currentValue: string,
  setter: (value: string) => void,
) => {
  const SpeechRecognition =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert(
      'Voice dictation is not supported in this browser. Please use the microphone on your keyboard.',
    );
    return;
  }

  if (activeListeningField === field) {
    speechRecognitionRef.current?.stop();
    speechRecognitionRef.current = null;
    setActiveListeningField(null);
    return;
  }

  speechRecognitionRef.current?.stop();

  try {
    const recognition = new SpeechRecognition();
    const originalText = currentValue.trim();
    let finalTranscript = '';

    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let interimTranscript = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0].transcript.trim();

        if (event.results[index].isFinal) {
          finalTranscript += `${transcript} `;
        } else {
          interimTranscript += `${transcript} `;
        }
      }

      setter(
        [originalText, finalTranscript.trim(), interimTranscript.trim()]
          .filter(Boolean)
          .join(' '),
      );
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        console.error('Voice dictation error:', event.error);
      }
    };

    recognition.onend = () => {
      if (speechRecognitionRef.current === recognition) {
        speechRecognitionRef.current = null;
        setActiveListeningField(null);
      }
    };

    speechRecognitionRef.current = recognition;
    setActiveListeningField(field);
    recognition.start();
  } catch {
    speechRecognitionRef.current = null;
    setActiveListeningField(null);
  }
};
  
  const buildSigningUrl = (token: string) => `${window.location.origin}?sign=${encodeURIComponent(token)}`;

  const triggerNativeSms = (
  phone: string,
  name: string,
  project: string,
  amount: string | number,
  signingToken?: string,
  type?: string,
) => {
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const token = signingToken || currentSigningToken;
  const currentType = type || orderType;
  const url = token ? buildSigningUrl(token) : window.location.href;
  const bodyText =
    `Hi ${name || 'there'}, please review and authorize the ` +
    `${currentType} for "${project || 'Job'}" ($${amount}): ${url}`;

  window.location.href =
    `sms:${cleanPhone}?body=${encodeURIComponent(bodyText)}`;
};
  
  const deleteOrderPermanently = async (orderId: string) => {
    if (!confirm("This order will be permanently removed from your dashboard. Are you sure you want to delete it?")) {  
      return;
    }
    try {
      const { error } = await supabase.rpc('archive_order', { p_order_id: orderId });
      if (error) throw error;
      setOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (err) {
      console.error("Failed to delete order:", err);
      alert("We couldn't archive this order. Please try again.");
    }
  };

  const saveProfile = (newProfile: ContractorProfile) => {
    setProfile(newProfile);
    localStorage.setItem('fieldsign_contractor_profile', JSON.stringify(newProfile));
  };

  const loadContractorProfile = async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from('contractor_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (error) {
      console.error('Profile load failed:', error);
      return;
    }
    if (!data) return;

    saveProfile({
      companyName: data.company_name || 'FieldSign Contractor',
      licenseNumber: data.license_number || '',
      phone: data.phone || '',
      email: data.email || session.user.email || '',
      logoDataUrl: data.logo_data_url || '',
      customTerms: data.custom_terms || DEFAULT_TERMS,
      requirePaymentUpfront: Boolean(data.require_payment_upfront),
      stripeAccountId: data.stripe_account_id || '',
      stripeChargesEnabled: Boolean(data.stripe_charges_enabled),
      stripeDetailsSubmitted: Boolean(data.stripe_details_submitted),
    });
  };

  const persistContractorProfile = async () => {
    if (!session) return;
    const { error } = await supabase.from('contractor_profiles').upsert({
      user_id: session.user.id,
      company_name: profile.companyName.trim() || 'FieldSign Contractor',
      license_number: profile.licenseNumber.trim() || null,
      phone: profile.phone.trim() || null,
      email: profile.email.trim() || session.user.email || null,
      logo_data_url: profile.logoDataUrl || null,
      custom_terms: profile.customTerms.trim() || DEFAULT_TERMS,
      require_payment_upfront: profile.requirePaymentUpfront,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) throw error;
  };
  const saveSettingsAndReturn = async () => {
  if (profileSaveInProgress.current) return;

  profileSaveInProgress.current = true;
  setIsSavingProfile(true);

  try {
    await persistContractorProfile();
    setView('dashboard');
  } catch (error) {
    console.error('Settings save failed:', error);
    alert('Settings could not be saved. Please try again.');
  } finally {
    profileSaveInProgress.current = false;
    setIsSavingProfile(false);
  }
};
  const connectStripe = async () => {
    setIsConnectingStripe(true);
    try {
      await persistContractorProfile();
      const { data, error } = await supabase.functions.invoke('stripe-connect-onboard');
      if (error) throw error;
      if (data?.status === 'connected') {
        await loadContractorProfile();
        alert('Stripe is connected and ready to accept payments.');
      } else if (data?.url) {
        window.location.assign(data.url);
      } else {
        throw new Error('Stripe onboarding did not return a secure link.');
      }
    } catch (error) {
      console.error('Stripe connection failed:', error);
      alert('We could not open Stripe onboarding. Please try again.');
    } finally {
      setIsConnectingStripe(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => saveProfile({ ...profile, logoDataUrl: reader.result as string });
      reader.readAsDataURL(file);
    }
  };

  const processImageUpload = (file: File, callback: (base64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
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
        callback(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };
  useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const signingToken = params.get('sign');
  const passwordRecovery = params.get('reset-password') === '1';

  if (signingToken) {
    setIsClientMode(true);
    setCurrentSigningToken(signingToken);
    void loadOrderFromDb(signingToken);
    setAuthReady(true);
    return;
  }

  setIsClientMode(false);
  setIsPasswordRecovery(passwordRecovery);

  void supabase.auth.getSession().then(({ data }) => {
    setSession(data.session);
    setAuthReady(true);
  });

  const { data: authListener } = supabase.auth.onAuthStateChange(
    (event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }

      setSession(nextSession);
      setAuthReady(true);
    },
  );

  return () => authListener.subscription.unsubscribe();
}, []);
  
  // Dashboard request tracking prevents older responses from
// overwriting newer data or repopulating a signed-out account.
const dashboardRequestId = useRef(0);
const dashboardUserId = session?.user.id;

const fetchDashboardOrders = useCallback(
  async (silent = false): Promise<boolean> => {
    if (!dashboardUserId || isClientMode) return false;

    const requestId = ++dashboardRequestId.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      12_000
    );

    if (!silent) setIsLoadingOrders(true);

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('owner_id', dashboardUserId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .abortSignal(controller.signal);

      if (error) throw error;

      if (requestId !== dashboardRequestId.current) {
        return false;
      }

      setOrders((data || []) as OrderRecord[]);
      return true;
    } catch (error) {
      if (requestId === dashboardRequestId.current) {
        console.error('Dashboard refresh failed:', error);
      }

      // Preserve the existing dashboard if a request fails.
      return false;
    } finally {
      window.clearTimeout(timeoutId);

      if (requestId === dashboardRequestId.current) {
        setIsLoadingOrders(false);
      }
    }
  },
  [dashboardUserId, isClientMode]
);

// Never retain one account's orders when the account changes.
useEffect(() => {
  setOrders([]);
}, [dashboardUserId]);

// Profile loading stays separate from live dashboard updates.
useEffect(() => {
  if (!isClientMode && dashboardUserId) {
    void loadContractorProfile();
  }
}, [isClientMode, dashboardUserId]);

useEffect(() => {
  if (
    isClientMode ||
    !dashboardUserId ||
    view !== 'dashboard'
  ) {
    return;
  }

  let active = true;
  let connected = false;
  let refreshing = false;
  let refreshQueued = false;
  let lastSuccessfulRefresh = 0;

  const refresh = async (silent = true): Promise<void> => {
    if (
      !active ||
      document.visibilityState !== 'visible' ||
      !navigator.onLine
    ) {
      return;
    }

    // Combine bursts of events instead of starting many requests.
    if (refreshing) {
      refreshQueued = true;
      return;
    }

    refreshing = true;

    try {
      const succeeded = await fetchDashboardOrders(silent);

      if (active) {
        lastSuccessfulRefresh = succeeded ? Date.now() : 0;
      }
    } finally {
      refreshing = false;

      if (active && refreshQueued) {
        refreshQueued = false;
        void refresh();
      }
    }
  };

  // Load immediately when entering the dashboard.
  void refresh(false);

  const channel = supabase
    .channel(`contractor-orders:${dashboardUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `owner_id=eq.${dashboardUserId}`
      },
      () => {
        void refresh();
      }
    )
    .subscribe((status, error) => {
      if (!active) return;

      connected = status === 'SUBSCRIBED';

      if (connected) {
        // Catch changes made before subscribing or while disconnected.
        void refresh();
      } else if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        console.warn(
          'Live updates interrupted; backup checks remain active.',
          error
        );
      }
    });

  const onReturn = () => {
    void refresh();
  };

  const onOffline = () => {
    connected = false;
  };

  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('focus', onReturn);
  window.addEventListener('pageshow', onReturn);
  window.addEventListener('online', onReturn);
  window.addEventListener('offline', onOffline);

  // Check every five seconds if live updates are unavailable.
  // With a live connection, reconcile only once per minute.
  const backupTimer = window.setInterval(() => {
    if (refreshing) return;

    if (
      !connected ||
      Date.now() - lastSuccessfulRefresh >= 60_000
    ) {
      void refresh();
    }
  }, 5_000);

  return () => {
    active = false;
    refreshQueued = false;
    dashboardRequestId.current += 1;

    window.clearInterval(backupTimer);
    document.removeEventListener('visibilitychange', onReturn);
    window.removeEventListener('focus', onReturn);
    window.removeEventListener('pageshow', onReturn);
    window.removeEventListener('online', onReturn);
    window.removeEventListener('offline', onOffline);

    void supabase.removeChannel(channel);
  };
}, [dashboardUserId, isClientMode, view, fetchDashboardOrders]);
  
  const loadOrderFromDb = async (signingToken: string) => {
    setClientLoadError('');
    try {
      const { data, error } = await supabase.rpc('get_order_for_signing', { p_token: signingToken });
      if (error) throw error;
      if (data && data.length > 0) {
        const o = data[0] as OrderRecord;
        // Only pending orders can display the authorization form.
// Signed orders can still display their locked receipt.
if (o.status !== 'pending' && o.status !== 'signed') {
  setCurrentOrderId(null);
  setEditingOrderId(null);
setCurrentSigningToken(null);
  setCurrentSigningToken(null);
  setAcceptedTerms(false);
  setHasSignature(false);
  setSignatureData(null);
  setSignerName('');
  setClientResponseMode(null);

  if (o.status === 'changes_requested') {
    setClientLoadError(
      'Your requested changes have been recorded. This authorization link is now closed. Please wait for the contractor to send a revised order with a new link.'
    );
  } else if (o.status === 'declined') {
    setClientLoadError(
      'This order has been declined, and this authorization link is now closed. If the contractor revises the order, they will send you a new link.'
    );
  } else {
    setClientLoadError(
      'This order is not available for authorization. Please ask the contractor for the latest review link.'
    );
  }

  return;
}
        setCurrentOrderId(o.id);
        setCurrentSigningToken(signingToken);
        setOrderType(o.order_type === 'New Job Agreement' ? 'New Job Agreement' : 'Change Order');
        setProjectTitle(o.project_title || '');
        setClientName(o.client_name || '');
        setClientPhone(o.client_phone || '');
        setDescription(o.description || '');
        setCost(o.cost?.toString() || '0');
        setPhotoData1(o.photo_data || '');
        setPhotoData2(o.photo_data_2 || '');
        setPaymentStatus((o.payment_status as typeof paymentStatus) || 'unpaid');

        // Map Saved Contractor Profile
        setOrderContractorName(o.contractor_company || profile.companyName);
        setOrderContractorLogo(o.contractor_logo || profile.logoDataUrl);
        setOrderContractorLicense(o.contractor_license || profile.licenseNumber);
        setOrderContractorPhone(o.contractor_phone || profile.phone);
        setOrderContractorEmail(o.contractor_email || profile.email);
        setOrderTerms(o.custom_terms || profile.customTerms || DEFAULT_TERMS);
        setOrderRequirePaymentUpfront(Boolean(o.require_payment_upfront));
        setOrderPaymentsEnabled(Boolean(o.payments_enabled));

        if (o.status === 'signed') {
          setSignatureData(o.signature_data || null);
          setSignerName(o.signer_name || o.client_name || '');
          setSignTimestamp(o.signed_at_utc || o.signed_at || '');
          setView('signed_receipt');
        } else {
          setAcceptedTerms(false);
          setSignerName('');
          setHasSignature(false);
          setView('client_review');
        }
      } else {
        setClientLoadError('This signing link is invalid or has expired. Please ask the contractor for a new link.');
      }
    } catch (err) {
      console.error('Error fetching order:', err);
      setClientLoadError('We could not open this authorization. Please ask the contractor for a new link.');
    }
  };

const openOrderForRevision = async (order: OrderRecord) => {
  if (revisionOpeningId) return;

  setRevisionOpeningId(order.id);

  try {
    let activeSigningToken = order.signing_token || null;

    // Drafts were already rotated and can simply be reopened.
    if (order.status !== 'draft') {
      const { data, error } = await supabase.rpc(
        'fieldsign_start_revision',
        {
          p_order_id: order.id,
          p_revision_reason:
            order.client_response_note ||
            'Contractor initiated an order revision.'
        }
      );

      if (error) throw error;

      const revisionResult = data as {
        signing_token?: string;
        revision_number?: number;
      } | null;

      activeSigningToken =
        revisionResult?.signing_token || null;
    }

    setEditingOrderId(order.id);
    setCurrentOrderId(order.id);
    setCurrentSigningToken(activeSigningToken);

    setOrderType(
      order.order_type as
        | 'Change Order'
        | 'New Job Agreement'
    );

    setClientName(order.client_name);
    setClientPhone(order.client_phone);
    setProjectTitle(order.project_title);
    setDescription(order.description);
    setCost(String(order.cost));
    setPhotoData1(order.photo_data || '');
    setPhotoData2(order.photo_data_2 || '');

    setView('contractor');

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  } catch (err: unknown) {
    console.error('Revision preparation error:', err);

    alert(
      err instanceof Error
        ? err.message
        : 'This order could not be opened for revision.'
    );
  } finally {
    setRevisionOpeningId(null);
  }
};
  const createOrder = async () => {
  const parsedCost = Number(cost);

  if (
    !clientName.trim() ||
    !clientPhone.trim() ||
    !projectTitle.trim() ||
    !description.trim() ||
    !Number.isFinite(parsedCost) ||
    parsedCost <= 0
  ) {
    alert(
      'Please enter the client, phone number, project, scope description, and a valid amount greater than $0.'
    );
    return;
  }

  if (orderSubmissionInProgress.current) return;

  orderSubmissionInProgress.current = true;
  setIsSaving(true);

  try {
    const sharedPayload: Record<string, any> = {
      order_type: orderType,
      contractor_company: profile.companyName,
      contractor_logo: profile.logoDataUrl || null,
      contractor_license: profile.licenseNumber || null,
      contractor_phone: profile.phone || null,
      contractor_email: profile.email || null,
      custom_terms:
        profile.customTerms || DEFAULT_TERMS,
      project_title: projectTitle.trim(),
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      description: description.trim(),
      cost: parsedCost,
      photo_data: photoData1 || null,
      photo_data_2: photoData2 || null,
      require_payment_upfront:
        profile.requirePaymentUpfront
    };

    let savedOrder: OrderRecord;

    if (editingOrderId) {
      // Keep the revised record as a draft while its contents update.
      const { data: updatedOrder, error: updateError } =
        await supabase
          .from('orders')
          .update({
            ...sharedPayload,
            status: 'draft'
          })
          .eq('id', editingOrderId)
          .select()
          .single();

      if (updateError) throw updateError;
      if (!updatedOrder) {
        throw new Error('The revised order could not be saved.');
      }

      // Publish the revision and activate its new signing link.
      const { data: sendResult, error: sendError } =
        await supabase.rpc(
          'fieldsign_send_for_review',
          {
            p_order_id: editingOrderId
          }
        );

      if (sendError) throw sendError;

      const reviewResult = sendResult as {
        signing_token?: string;
      } | null;

      savedOrder = {
        ...(updatedOrder as OrderRecord),
        status: 'pending',
        signing_token:
          reviewResult?.signing_token ||
          (updatedOrder as OrderRecord).signing_token
      };
    } else {
      const { data: createdOrder, error: insertError } =
        await supabase
          .from('orders')
          .insert({
            ...sharedPayload,
            status: 'pending',
            payment_status: 'unpaid'
          })
          .select()
          .single();

      if (insertError) throw insertError;
      if (!createdOrder) {
        throw new Error('The order could not be created.');
      }

      savedOrder = createdOrder as OrderRecord;
    }

    setCurrentOrderId(savedOrder.id);
    setCurrentSigningToken(
      savedOrder.signing_token || null
    );

    setEditingOrderId(null);

    await fetchDashboardOrders();
    setView('dashboard');

    if (savedOrder.signing_token) {
      triggerNativeSms(
        savedOrder.client_phone,
        savedOrder.client_name,
        savedOrder.project_title,
        savedOrder.cost,
        savedOrder.signing_token,
        savedOrder.order_type
      );
    }
  } catch (err: unknown) {
    console.error('Database save error:', err);

    alert(
      err instanceof Error
        ? err.message
        : 'Failed to save the order.'
    );
  } finally {
    orderSubmissionInProgress.current = false;
    setIsSaving(false);
  }
};
  const getCoordinates = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches && e.touches.length > 0) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    } else if (e.clientX !== undefined) {
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }
    return null;
  };

  const handleStartDraw = (e: any) => {
    if (e.cancelable) e.preventDefault();
    isDrawing.current = true;
    const coords = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!coords || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setHasSignature(true);
  };

  const handleDraw = (e: any) => {
    if (e.cancelable) e.preventDefault();
    if (!isDrawing.current) return;
    const coords = getCoordinates(e);
    const canvas = canvasRef.current;
    if (!coords || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
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
    setHasSignature(false);
  };

  const openSecureCheckout = async (existingWindow?: Window | null) => {
    if (!currentSigningToken) throw new Error('The secure signing token is missing.');
    const paymentWindow = existingWindow || window.open('about:blank', '_blank');
    if (!paymentWindow) throw new Error('Please allow pop-ups to continue to secure payment.');

    const { data, error } = await supabase.functions.invoke('create-checkout', {
      body: { signingToken: currentSigningToken },
    });
    if (error || !data?.url) {
      paymentWindow.close();
      throw error || new Error('Secure checkout is unavailable.');
    }
    paymentWindow.location.href = data.url;
  };

  const finalizeSignatureAndPay = async (openStripe: boolean = false) => {
    if (!acceptedTerms) {
      alert("Please accept the authorization terms before signing.");
      return;
    }

    if (!signerName.trim()) {
      alert("Please enter the signer’s full name.");
      return;
    }

    if (!hasSignature) {
      alert("Please draw your signature before authorizing this document.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas || !currentSigningToken) return;

    const signature = canvas.toDataURL();
    const paymentWindow = openStripe ? window.open('about:blank', '_blank') : null;

    try {
      const { data, error } = await supabase.rpc('sign_order', {
        p_token: currentSigningToken,
        p_signer_name: signerName.trim(),
        p_signature_data: signature,
        p_consent_text: CONSENT_TEXT,
        p_user_agent: navigator.userAgent,
        p_payment_requested: openStripe,
      });
      if (error) throw error;

      const result = data?.[0];
      setSignatureData(signature);
      setSignTimestamp(result?.signed_at_utc || new Date().toISOString());
      setPaymentStatus(result?.payment_status || (openStripe ? 'pending' : 'unpaid'));
      setView('signed_receipt');
    } catch (err) {
      paymentWindow?.close();
      console.error('Error recording signature:', err);
      alert(err instanceof Error ? err.message : 'We could not save the signature. Please try again.');
      return;
    }

    if (openStripe) {
      try {
        await openSecureCheckout(paymentWindow);
      } catch (error) {
        console.error('Checkout failed:', error);
        alert('Your authorization was saved, but secure payment could not open. Use Continue to Payment to try again.');
      }
    } else {
      paymentWindow?.close();
    }
  };

  const handleDownloadPdf = async (targetDoc?: { 
    company?: string; 
    logo?: string;
    license?: string;
    phone?: string;
    email?: string;
    terms?: string;
    type?: string; 
    project?: string; 
    client?: string; 
    clientPhone?: string; 
    desc?: string; 
    amount?: string | number; 
    sig?: string; 
    date?: string; 
    docId?: string; 
    isPaid?: boolean; 
    photo1?: string; 
    photo2?: string 
  }) => {
    const { jsPDF } = await import('jspdf');
    const dCompany = targetDoc?.company || orderContractorName || profile.companyName;
    const dLogo = targetDoc?.logo || orderContractorLogo || profile.logoDataUrl;
    const dLicense = targetDoc?.license || orderContractorLicense || profile.licenseNumber;
    const dContractorPhone = targetDoc?.phone || orderContractorPhone || profile.phone;
    const dContractorEmail = targetDoc?.email || orderContractorEmail || profile.email;
    const dTerms = targetDoc?.terms || orderTerms || profile.customTerms || DEFAULT_TERMS;

    const dType = targetDoc?.type || orderType;
    const dProject = targetDoc?.project || projectTitle;
    const dClient = targetDoc?.client || clientName;
    const dClientPhone = targetDoc?.clientPhone || clientPhone;
    const dDesc = targetDoc?.desc || description;
    const dCost = targetDoc?.amount || cost;
    const dSig = targetDoc?.sig || signatureData;
    const dPhoto1 = targetDoc?.photo1 || photoData1;
    const dPhoto2 = targetDoc?.photo2 || photoData2;
    const dTimestamp = targetDoc?.date || signTimestamp;
    const dId = targetDoc?.docId || currentOrderId;
    const dPaid = targetDoc?.isPaid !== undefined ? targetDoc.isPaid : (paymentStatus === 'paid');

    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const primaryColor = [15, 23, 42];
    const accentColor = [245, 158, 11];
    const grayText = [100, 116, 139];

    doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.rect(0, 0, 612, 10, 'F');

    let textLeftMargin = 40;
    if (dLogo) {
      try {
        doc.addImage(dLogo, dLogo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 40, 26, 45, 45);
        textLeftMargin = 95;
      } catch {
        textLeftMargin = 40;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(dCompany.toUpperCase(), textLeftMargin, 42);

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(`License: ${dLicense || 'N/A'}  •  Phone: ${dContractorPhone}  •  ${dContractorEmail}`, textLeftMargin, 56);
    doc.text('OFFICIAL WORK AUTHORIZATION & PAYMENT RECORD', textLeftMargin, 68);

    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.roundedRect(400, 30, 172, 26, 4, 4, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(255, 255, 255);
    doc.text(dType.toUpperCase(), 486, 47, { align: 'center' });

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(1);
    doc.line(40, 80, 572, 80);

    // Details Grid
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, 92, 258, 65, 6, 6, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(40, 92, 258, 65, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('PROJECT DETAILS', 52, 106);

    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(`Project: ${dProject}`, 52, 122);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Ref: ${dId ? dId.slice(0, 8) : 'RECORD'}  •  Date: ${new Date().toLocaleDateString()}`, 52, 138);

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(314, 92, 258, 65, 6, 6, 'F');
    doc.roundedRect(314, 92, 258, 65, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('CLIENT & STATUS', 326, 106);

    doc.setFontSize(10);
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.text(`Client: ${dClient}`, 326, 122);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Phone: ${dClientPhone}  •  Status: ${dPaid ? 'Direct Paid' : 'Authorized'}`, 326, 138);

    // Scope & Dual Photo Section
    const hasPhotos = dPhoto1 || dPhoto2;
    const scopeHeight = hasPhotos ? 170 : 120;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(40, 165, 532, scopeHeight, 6, 6, 'F');
    doc.roundedRect(40, 165, 532, scopeHeight, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text('AUTHORIZED SCOPE & EVIDENCE', 52, 180);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);

    if (hasPhotos) {
      doc.text(doc.splitTextToSize(dDesc || 'Work authorization details.', 250).slice(0, 12), 52, 196);
      if (dPhoto1) {
        try { doc.addImage(dPhoto1, 'JPEG', 315, 175, 115, 105); } catch {}
      }
      if (dPhoto2) {
        try { doc.addImage(dPhoto2, 'JPEG', 440, 175, 115, 105); } catch {}
      }
    } else {
      doc.text(doc.splitTextToSize(dDesc || 'Work authorization details.', 508).slice(0, 10), 52, 196);
    }

    const costY = 165 + scopeHeight + 10;
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.roundedRect(40, costY, 532, 40, 6, 6, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text('TOTAL AMOUNT AUTHORIZED :', 56, costY + 25);

    doc.setFontSize(16);
    doc.setTextColor(251, 191, 36);
    doc.text(`$${dCost || '0.00'} USD`, 556, costY + 26, { align: 'right' });

    const termsY = costY + 48;
    const termsLines = doc.splitTextToSize(dTerms, 512).slice(0, 8);
    const termsHeight = Math.max(46, 28 + termsLines.length * 8);
    doc.setFillColor(254, 252, 232);
    doc.roundedRect(40, termsY, 532, termsHeight, 4, 4, 'F');
    doc.setDrawColor(254, 240, 138);
    doc.roundedRect(40, termsY, 532, termsHeight, 4, 4, 'D');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('LEGAL AUTHORIZATION & PAYMENT TERMS:', 50, termsY + 12);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(113, 63, 18);
    doc.text(termsLines, 50, termsY + 24);

    const sigY = termsY + termsHeight + 8;
    doc.setDrawColor(203, 213, 225);
    doc.roundedRect(40, sigY, 532, 80, 6, 6, 'D');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text("CLIENT'S AUTHORIZED ELECTRONIC SIGNATURE", 52, sigY + 14);

    if (dSig) {
      try { doc.addImage(dSig, 'PNG', 52, sigY + 18, 200, 48); } catch {}
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(grayText[0], grayText[1], grayText[2]);
    doc.text(`Timestamp: ${dTimestamp || new Date().toLocaleString()}`, 350, sigY + 38);
    doc.text(`Status: ${dPaid ? 'Paid & Archived' : 'Authorized Document'}`, 350, sigY + 50);

    const pdfBlob = doc.output('blob');
const pdfUrl = URL.createObjectURL(pdfBlob);

// Reuse the same PDF preview tab instead of creating a new one each time.
const pdfWindow = window.open(pdfUrl, 'fieldsign-pdf-preview');

if (!pdfWindow) {
  // Fallback if the browser blocks the preview window.
  window.location.assign(pdfUrl);
}

// Release the temporary file after the browser has loaded it.
window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
  };

  const displayedOrders = filterTab === null ? [] : orders.filter(o => {
    if (filterTab === 'pending') return o.status === 'pending';
    if (filterTab === 'signed') return o.status === 'signed';
    return true;
  });

  const totalApprovedRevenue = orders
    .filter(o => o.status === 'signed')
    .reduce((sum, o) => sum + (Number(o.cost) || 0), 0);
  const totalPaidRevenue = orders
    .filter(o => o.payment_status === 'paid')
    .reduce((sum, o) => sum + (Number(o.cost) || 0), 0);
  const signedCount = orders.filter(o => o.status === 'signed').length;
  const pendingCount = orders.filter(o => o.status === 'pending').length;
  const attentionCount = orders.filter(
  o => o.status === 'changes_requested' || o.status === 'declined'
).length;
  const paidCount = orders.filter(o => o.payment_status === 'paid').length;
  if (!isClientMode && !authReady) {
  return <div className="app-loading" role="status">Opening FieldSign…</div>;
}

if (!isClientMode && isPasswordRecovery) {
  return (
    <AuthScreen
      recoveryMode
      onRecoveryComplete={() => {
        setIsPasswordRecovery(false);
        window.history.replaceState({}, '', window.location.pathname);
      }}
    />
  );
}

if (!isClientMode && !session) {
  return <AuthScreen />;
}
  if (isClientMode && clientLoadError) {
    return (
      <main className="auth-shell">
        <section className="auth-card" role="alert">
          <span className="sub-tag">FieldSign authorization</span>
          <h1>Link unavailable</h1>
          <p>{clientLoadError}</p>
        </section>
      </main>
    );
  }

  if (isClientMode && !currentOrderId) {
    return <div className="app-loading" role="status">Opening secure authorization…</div>;
  }
  
const handleClientResponse = async (
  response: 'changes_requested' | 'declined'
) => {
  if (!currentSigningToken) {
    alert('This signing link is unavailable or no longer valid.');
    return;
  }

  const responseNote = clientResponseNote.trim();

  if (response === 'changes_requested' && !responseNote) {
    alert('Please describe the changes you would like the contractor to make.');
    return;
  }

  setIsSubmittingClientResponse(true);

  try {
    const { error } = await supabase.rpc(
      'fieldsign_submit_client_response',
      {
        p_signing_token: currentSigningToken,
        p_response: response,
        p_note: responseNote || null
      }
    );

    if (error) throw error;

    setClientResponseSubmitted(response);
    setClientResponseMode(null);
  } catch (err: any) {
    console.error('Client response error:', err);

    alert(
      err.message ||
        'Your response could not be recorded. Please try again.'
    );
  } finally {
    setIsSubmittingClientResponse(false);
  }
};
  return (
    <div className="app-container">
   {!isClientMode && (
  <header className="demo-banner">
    <span className="demo-brand">⚡ FieldSign Contractor Portal</span>

    <nav className="demo-btn-group" aria-label="Contractor navigation">
      <button
        type="button"
        onClick={() => {
          void fetchDashboardOrders();
          setView('dashboard');
          setIsAccountMenuOpen(false);
        }}
        className={`demo-btn ${view === 'dashboard' ? 'active' : ''}`}
      >
        📊 Dashboard
      </button>

      <button
        type="button"
        onClick={() => {
          setOrderType('Change Order');
          setClientName('');
          setClientPhone('');
          setProjectTitle('');
          setDescription('');
          setCost('');
          setPhotoData1('');
          setPhotoData2('');
          setCurrentOrderId(null);
          setView('contractor');
          setIsAccountMenuOpen(false);
        }}
        className={`demo-btn ${view === 'contractor' ? 'active' : ''}`}
      >
        + New Order
      </button>
    </nav>

    <div className="account-menu">
      <button
        type="button"
        className="account-menu-trigger"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={isAccountMenuOpen}
        onClick={() => setIsAccountMenuOpen((open) => !open)}
      >
        <UserRound size={19} aria-hidden="true" />
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {isAccountMenuOpen && (
        <div className="account-dropdown" role="menu">
          <button
            type="button"
            className="account-dropdown-item"
            role="menuitem"
            onClick={() => {
              setView('settings');
              setIsAccountMenuOpen(false);
            }}
          >
            <Settings size={17} aria-hidden="true" />
            Profile &amp; settings
          </button>

          <button
            type="button"
            className="account-dropdown-item danger"
            role="menuitem"
            onClick={() => {
              setIsAccountMenuOpen(false);
              void supabase.auth.signOut();
            }}
          >
            <LogOut size={17} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  </header>
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

            <div style={{ background: '#0b1120', border: '1px solid #334155', borderRadius: '12px', padding: '14px', marginBottom: '16px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: profile.stripeChargesEnabled ? '#10b981' : '#38bdf8', textTransform: 'uppercase' }}>
                {profile.stripeChargesEnabled ? '✓ Stripe Connected' : 'Stripe Payments'}
              </span>
              <p style={{ fontSize: '11px', color: '#94a3b8', margin: '4px 0 10px 0' }}>
                {profile.stripeChargesEnabled
                  ? 'Client payments are deposited directly into your connected Stripe account.'
                  : 'Connect your own Stripe account before offering payment during client sign-off.'}
              </p>
              <button
                type="button"
                onClick={() => void connectStripe()}
                disabled={isConnectingStripe}
                className="btn-secondary"
                style={{ marginTop: 0 }}
              >
                {isConnectingStripe ? 'Opening Stripe…' : profile.stripeChargesEnabled ? 'Review Stripe connection' : 'Connect with Stripe'}
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                <input 
                  type="checkbox" 
                  id="requirePayment"
                  checked={profile.requirePaymentUpfront}
                  onChange={(e) => saveProfile({ ...profile, requirePaymentUpfront: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: '#f59e0b' }}
                />
                <label htmlFor="requirePayment" style={{ fontSize: '12px', color: '#cbd5e1', cursor: 'pointer' }}>
                  Offer secure payment after client authorization
                </label>
              </div>
            </div>

            <div className="form-group" style={{ textAlign: 'center', background: '#0b1120', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b' }}>
              <label className="form-label">Company Logo</label>
              {profile.logoDataUrl ? (
                <div style={{ margin: '10px 0' }}>
                  <img src={profile.logoDataUrl} alt="Logo" style={{ maxHeight: '60px', margin: '0 auto', borderRadius: '6px' }} />
                  <br />
                  <button 
                    type="button" 
                    onClick={() => saveProfile({ ...profile, logoDataUrl: '' })}
                    style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '11px', cursor: 'pointer', marginTop: '6px' }}
                  >
                    ✕ Remove Logo
                  </button>
                </div>
              ) : (
                <p style={{ fontSize: '11px', color: '#64748b', margin: '8px 0' }}>No logo uploaded yet</p>
              )}
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ fontSize: '12px', border: 'none', background: 'transparent' }} />
            </div>

            <div className="form-group">
              <label className="form-label">Business / Contractor Name</label>
              <input type="text" value={profile.companyName} onChange={(e) => saveProfile({ ...profile, companyName: e.target.value })} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">License / Reg #</label>
                <input type="text" value={profile.licenseNumber} onChange={(e) => saveProfile({ ...profile, licenseNumber: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Office Phone</label>
                <input 
                  type="text" 
                  value={profile.phone} 
                  onChange={(e) => saveProfile({ ...profile, phone: e.target.value })} 
                  placeholder="(000) 000-0000"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Business Email</label>
              <input type="text" value={profile.email} onChange={(e) => saveProfile({ ...profile, email: e.target.value })} />
            </div>

            <div className="form-group">
              <label className="form-label">Custom Legal Authorization Terms</label>
              <textarea rows={3} value={profile.customTerms} onChange={(e) => saveProfile({ ...profile, customTerms: e.target.value })} />
            </div>

            <button
  type="button"
  onClick={() => void saveSettingsAndReturn()}
  disabled={isSavingProfile}
  className="btn-primary"
  aria-busy={isSavingProfile}
>
  {isSavingProfile ? 'Saving settings…' : '✓ Save Settings & Return'}
</button> 
          </div>
        )}

        {/* VIEW 0: CONTRACTOR DASHBOARD */}
        {view === 'dashboard' && !isClientMode && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
              <div style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: '14px', padding: '14px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Approved Volume</span>
                <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#10b981', marginTop: '2px' }}>
                  ${totalApprovedRevenue.toLocaleString()}
                </h3>
                <span style={{ fontSize: '10px', color: '#64748b' }}>{signedCount} signed orders</span>
              </div>

              <div style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: '14px', padding: '14px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Direct Paid (Stripe)</span>
                <h3 style={{ fontSize: '22px', fontWeight: 900, color: '#38bdf8', marginTop: '2px' }}>
                  ${totalPaidRevenue.toLocaleString()}
                </h3>
                <span style={{ fontSize: '10px', color: '#64748b' }}>{paidCount} confirmed payments</span>
              </div>
            </div>

          {attentionCount > 0 && (
  <div
    style={{
      marginBottom: '14px',
      padding: '11px 12px',
      border: '1px solid rgba(56, 189, 248, 0.45)',
      borderRadius: '11px',
      background: 'rgba(56, 189, 248, 0.1)',
      color: '#bae6fd',
      fontSize: '12px',
      fontWeight: 800,
      lineHeight: 1.45
    }}
  >
    ⚠ {attentionCount}{' '}
    {attentionCount === 1 ? 'client response requires' : 'client responses require'} your attention.
  </div>
)}
            {/* Collapsible / Accordion Status Buttons */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => handleTabToggle('active')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'active' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'active' ? '#0f172a' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                All Orders ({orders.length}) {filterTab === 'active' ? '▲' : '▼'}
              </button>

              <button
                type="button"
                onClick={() => handleTabToggle('pending')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'pending' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'pending' ? '#0f172a' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                ⏳ Pending ({pendingCount}) {filterTab === 'pending' ? '▲' : '▼'}
              </button>

              <button
                type="button"
                onClick={() => handleTabToggle('signed')}
                style={{
                  padding: '6px 14px',
                  borderRadius: '20px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  background: filterTab === 'signed' ? '#f59e0b' : '#1e293b',
                  color: filterTab === 'signed' ? '#0f172a' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                ✓ Signed ({signedCount}) {filterTab === 'signed' ? '▲' : '▼'}
              </button>
            </div>

            {filterTab === null && (
              <div style={{ textAlign: 'center', padding: '16px', color: '#64748b', fontSize: '12px' }}>
                Tap any status category above to expand orders ▼
              </div>
            )}

            {filterTab !== null && displayedOrders.length === 0 && !isLoadingOrders && (
              <div className="card-dark" style={{ textAlign: 'center', padding: '36px 16px' }}>
                <span style={{ fontSize: '32px' }}>📝</span>
                <h4 style={{ fontSize: '15px', fontWeight: 700, marginTop: '8px' }}>No orders found</h4>
                <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                  No orders match this status.
                </p>
              </div>
            )}

            {filterTab !== null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {displayedOrders.map((o) => (
                  <div key={o.id} style={{ background: '#131b2e', border: '1px solid #1e293b', borderRadius: '14px', padding: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase' }}>
                          {o.order_type || 'Change Order'}
                        </span>
                        <h4 style={{ fontSize: '15px', fontWeight: 800, marginTop: '1px' }}>{o.project_title}</h4>
                        <p style={{ fontSize: '12px', color: '#94a3b8' }}>Client: <strong>{o.client_name}</strong> ({o.client_phone})</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '16px', fontWeight: 900, color: o.status === 'signed' ? '#10b981' : '#f1f5f9' }}>
                          ${o.cost}
                        </span>
                        <div
  style={{
    display: 'flex',
    gap: '4px',
    justifyContent: 'flex-end',
    marginTop: '4px'
  }}
>
  <span
    style={{
      fontSize: '9px',
      fontWeight: 800,
      padding: '2px 6px',
      borderRadius: '8px',
      background: ORDER_STATUS_META[o.status].background,
      color: ORDER_STATUS_META[o.status].color
    }}
  >
    {ORDER_STATUS_META[o.status].label}
  </span>

  {o.payment_status === 'paid' && (
    <span
      style={{
        fontSize: '9px',
        fontWeight: 800,
        padding: '2px 6px',
        borderRadius: '8px',
        background: 'rgba(56, 189, 248, 0.15)',
        color: '#38bdf8'
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
    margin: '8px 0'
  }}
>
  {o.description}
</p>

{(o.status === 'changes_requested' ||
  o.status === 'declined') && (
  <div
    style={{
      margin: '8px 0',
      padding: '10px',
      borderRadius: '9px',
      border:
        o.status === 'changes_requested'
          ? '1px solid rgba(56, 189, 248, 0.45)'
          : '1px solid rgba(239, 68, 68, 0.4)',
      background:
        o.status === 'changes_requested'
          ? 'rgba(56, 189, 248, 0.1)'
          : 'rgba(239, 68, 68, 0.1)'
    }}
  >
    <span
      style={{
        display: 'block',
        marginBottom: '4px',
        color:
          o.status === 'changes_requested'
            ? '#7dd3fc'
            : '#fca5a5',
        fontSize: '10px',
        fontWeight: 900,
        textTransform: 'uppercase'
      }}
    >
      {o.status === 'changes_requested'
        ? 'Client requested changes'
        : 'Client declined this order'}
    </span>

    <p
      style={{
        color: '#e2e8f0',
        fontSize: '12px',
        lineHeight: 1.5
      }}
    >
      {o.client_response_note ||
        'The client did not include an additional message.'}
    </p>
  </div>
)}
{(
  o.status === 'draft' ||
  o.status === 'changes_requested' ||
  o.status === 'declined'
) && (
  <button
    type="button"
    onClick={() => void openOrderForRevision(o)}
    disabled={revisionOpeningId !== null}
    style={{
      width: '100%',
      marginTop: '10px',
      padding: '9px',
      borderRadius: '9px',
      border: '1px solid #38bdf8',
      background: 'rgba(56, 189, 248, 0.12)',
      color: '#7dd3fc',
      fontSize: '11px',
      fontWeight: 900,
      cursor:
        revisionOpeningId !== null
          ? 'not-allowed'
          : 'pointer',
      opacity:
        revisionOpeningId !== null &&
        revisionOpeningId !== o.id
          ? 0.55
          : 1
    }}
  >
    {revisionOpeningId === o.id
      ? 'Preparing Secure Revision…'
      : o.status === 'draft'
        ? '✎ Continue Editing Draft'
        : '✎ Revise Order'}
  </button>
)}                    
  <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
    {o.status === 'pending' && (
  <>
    <button
                        type="button"
                        onClick={() => o.signing_token && triggerNativeSms(o.client_phone, o.client_name, o.project_title, o.cost, o.signing_token, o.order_type)}
                        style={{ flex: 1.2, padding: '8px', borderRadius: '8px', border: '1px solid #10b981', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                      >
                        💬 Text SMS
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!o.signing_token) return;
                          void navigator.clipboard.writeText(buildSigningUrl(o.signing_token));
                          alert(`Secure signing link copied for ${o.client_name}.`);
                        }}
                        style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid #334155', background: '#1e293b', color: '#38bdf8', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        📋 Copy Link
                      </button>
      </>
)}
                      {o.status === 'signed' && (
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf({
                            company: o.contractor_company,
                            logo: o.contractor_logo,
                            license: o.contractor_license,
                            phone: o.contractor_phone,
                            email: o.contractor_email,
                            terms: o.custom_terms,
                            type: o.order_type,
                            project: o.project_title,
                            client: o.client_name,
                            clientPhone: o.client_phone,
                            desc: o.description,
                            amount: o.cost,
                            photo1: o.photo_data,
                            photo2: o.photo_data_2,
                            sig: o.signature_data,
                            date: o.signed_at_utc || o.signed_at,
                            docId: o.id,
                            isPaid: o.payment_status === 'paid'
                          })}
                          style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', background: '#10b981', color: '#ffffff', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
                        >
                          📄 PDF
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => deleteOrderPermanently(o.id)}
                        style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                        title="Permanently Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* VIEW 1: CONTRACTOR FORM WITH VOICE DICTATION & DUAL PHOTO INPUTS */}
        {view === 'contractor' && !isClientMode && (
          <div className="card-dark">
            <div style={{ display: 'flex', background: '#0b1120', padding: '4px', borderRadius: '10px', marginBottom: '16px', border: '1px solid #1e293b' }}>
              <button
                type="button"
                onClick={() => setOrderType('Change Order')}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', background: orderType === 'Change Order' ? '#f59e0b' : 'transparent', color: orderType === 'Change Order' ? '#0f172a' : '#94a3b8' }}
              >
                Scope Change (Add-on)
              </button>
              <button
                type="button"
                onClick={() => setOrderType('New Job Agreement')}
                style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', background: orderType === 'New Job Agreement' ? '#f59e0b' : 'transparent', color: orderType === 'New Job Agreement' ? '#0f172a' : '#94a3b8' }}
              >
                New Job Agreement
              </button>
            </div>

            <div className="card-header">
              <div>
                <span className="sub-tag">{profile.companyName}</span>
                <h2 className="card-title">{orderType === 'Change Order' ? 'Quick Change Order' : 'New Job Agreement'}</h2>
              </div>
              <span style={{ fontSize: '24px' }}>📋</span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Client Name</label>
                  <button
  type="button"
  onClick={() =>
    startDictation('clientName', clientName, setClientName)
  }
  className={`voice-dictation-btn ${
    activeListeningField === 'clientName' ? 'is-listening' : ''
  }`}
  aria-pressed={activeListeningField === 'clientName'}
>
  <AudioLines size={15} aria-hidden="true" />
  <span>Voice Dictation</span>

  {activeListeningField === 'clientName' && (
    <span className="voice-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )}
</button> 
                </div>
                <input 
                  type="text" 
                  value={clientName} 
                  onChange={(e) => setClientName(e.target.value)} 
                  placeholder="Enter client’s name"
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <label className="form-label" style={{ margin: 0 }}>Client Phone (for SMS)</label>
                  <button
  type="button"
  onClick={() =>
    startDictation('clientPhone', clientPhone, setClientPhone)
  }
  className={`voice-dictation-btn ${
    activeListeningField === 'clientPhone' ? 'is-listening' : ''
  }`}
  aria-pressed={activeListeningField === 'clientPhone'}
>
  <AudioLines size={15} aria-hidden="true" />
  <span>Voice Dictation</span>

  {activeListeningField === 'clientPhone' && (
    <span className="voice-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )}
</button> 
                </div>
                <input 
                  type="text" 
                  value={clientPhone} 
                  onChange={(e) => setClientPhone(e.target.value)} 
                  placeholder="(000) 000-0000"
                />
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label className="form-label" style={{ margin: 0 }}>Project / Job Name</label>
                <button
  type="button"
  onClick={() =>
    startDictation('projectTitle', projectTitle, setProjectTitle)
  }
  className={`voice-dictation-btn ${
    activeListeningField === 'projectTitle' ? 'is-listening' : ''
  }`}
  aria-pressed={activeListeningField === 'projectTitle'}
>
  <AudioLines size={15} aria-hidden="true" />
  <span>Voice Dictation</span>

  {activeListeningField === 'projectTitle' && (
    <span className="voice-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )}
</button>
              </div>
              <input 
                type="text" 
                value={projectTitle} 
                onChange={(e) => setProjectTitle(e.target.value)} 
                placeholder="Enter project name"
              />
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label className="form-label" style={{ margin: 0 }}>Scope Description</label>
                <button
  type="button"
  onClick={() =>
    startDictation('description', description, setDescription)
  }
  className={`voice-dictation-btn ${
    activeListeningField === 'description' ? 'is-listening' : ''
  }`}
  aria-pressed={activeListeningField === 'description'}
>
  <AudioLines size={15} aria-hidden="true" />
  <span>Voice Dictation</span>

  {activeListeningField === 'description' && (
    <span className="voice-wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )}
</button>
              </div>
              <textarea 
                rows={3} 
                value={description} 
                onChange={(e) => setDescription(e.target.value)} 
                placeholder="Describe labor, materials, or speak using the mic..." 
              />
            </div>

            {/* Dual Photo Attachment Box */}
            <div style={{ background: '#0b1120', border: '1px dashed #334155', borderRadius: '12px', padding: '12px', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', display: 'block', textAlign: 'center', marginBottom: '8px' }}>
                📷 Job-Site Evidence (Up to 2 Photos)
              </span>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'center' }}>
                {/* Photo Slot 1 */}
                <div style={{ background: '#131b2e', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                  <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Photo 1 (Issue)</span>
                  {photoData1 ? (
                    <div>
                      <img src={photoData1} alt="Slot 1" style={{ maxHeight: '75px', borderRadius: '6px', margin: '0 auto' }} />
                      <button type="button" onClick={() => setPhotoData1('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '10px', cursor: 'pointer', display: 'block', margin: '4px auto 0 auto' }}>✕ Remove</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '6px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
                        📷 Take Picture
                        <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && processImageUpload(e.target.files[0], setPhotoData1)} style={{ display: 'none' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: '#0b1120', color: '#94a3b8', border: '1px solid #1e293b', padding: '6px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
                        📁 Upload Photo
                        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && processImageUpload(e.target.files[0], setPhotoData1)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  )}
                </div>

                {/* Photo Slot 2 */}
                <div style={{ background: '#131b2e', padding: '10px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                  <span style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 700, display: 'block', marginBottom: '6px' }}>Photo 2 (Detail)</span>
                  {photoData2 ? (
                    <div>
                      <img src={photoData2} alt="Slot 2" style={{ maxHeight: '75px', borderRadius: '6px', margin: '0 auto' }} />
                      <button type="button" onClick={() => setPhotoData2('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '10px', cursor: 'pointer', display: 'block', margin: '4px auto 0 auto' }}>✕ Remove</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '6px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
                        📷 Take Picture
                        <input type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && processImageUpload(e.target.files[0], setPhotoData2)} style={{ display: 'none' }} />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', background: '#0b1120', color: '#94a3b8', border: '1px solid #1e293b', padding: '6px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}>
                        📁 Upload Photo
                        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && processImageUpload(e.target.files[0], setPhotoData2)} style={{ display: 'none' }} />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Authorized Amount ($ USD)</label>
              <input type="number" className="price-input" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
            </div>

            <button
  type="button"
  onClick={() => void createOrder()}
  disabled={isSaving}
  className="btn-primary"
  aria-busy={isSaving}
>
  {isSaving ? 'Saving order securely…' : '🚀 Save & Text Link to Client'}
</button>    
</div>
        )}

        {/* VIEW 2: CLIENT SIGN-OFF */}
{view === 'client_review' && (
  clientResponseSubmitted ? (
    <div className="card-light" style={{ textAlign: 'center' }}>
      <div
        style={{
          width: '52px',
          height: '52px',
          margin: '0 auto 14px',
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background:
            clientResponseSubmitted === 'changes_requested'
              ? '#e0f2fe'
              : '#fee2e2',
          color:
            clientResponseSubmitted === 'changes_requested'
              ? '#0369a1'
              : '#b91c1c',
          fontSize: '23px',
          fontWeight: 800
        }}
      >
        {clientResponseSubmitted === 'changes_requested' ? '✎' : '×'}
      </div>

      <h2
        style={{
          color: '#0f172a',
          fontSize: '20px',
          fontWeight: 800
        }}
      >
        {clientResponseSubmitted === 'changes_requested'
          ? 'Changes Requested'
          : 'Order Declined'}
      </h2>

      <p
        style={{
          color: '#64748b',
          fontSize: '13px',
          lineHeight: 1.6,
          marginTop: '8px'
        }}
      >
        {clientResponseSubmitted === 'changes_requested'
          ? `Your requested changes were recorded for ${
              orderContractorName || profile.companyName
            }. This order cannot be signed unless the contractor revises and resends it.`
          : `Your decision was recorded for ${
              orderContractorName || profile.companyName
            }. No authorization or payment was completed.`}
      </p>

      {clientResponseNote && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            borderRadius: '10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            textAlign: 'left'
          }}
        >
          <span
            style={{
              display: 'block',
              marginBottom: '5px',
              color: '#64748b',
              fontSize: '10px',
              fontWeight: 800,
              textTransform: 'uppercase'
            }}
          >
            Your message
          </span>

          <p
            style={{
              color: '#1e293b',
              fontSize: '13px',
              lineHeight: 1.5
            }}
          >
            {clientResponseNote}
          </p>
        </div>
      )}

      <p
        style={{
          color: '#94a3b8',
          fontSize: '11px',
          marginTop: '16px'
        }}
      >
        You may safely close this page.
      </p>
    </div>
  ) : (
    <div className="card-light">
      <div className="card-header">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          {(orderContractorLogo || profile.logoDataUrl) && (
            <img
              src={orderContractorLogo || profile.logoDataUrl}
              alt="Logo"
              style={{
                maxHeight: '35px',
                borderRadius: '4px'
              }}
            />
          )}

          <div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 800,
                color: '#d97706',
                textTransform: 'uppercase'
              }}
            >
              {orderContractorName || profile.companyName}
            </span>

            <h3
              style={{
                fontSize: '18px',
                fontWeight: 800,
                marginTop: '2px'
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
            fontWeight: 700
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
            borderTop: '1px solid #e2e8f0'
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#64748b',
              textTransform: 'uppercase'
            }}
          >
            Agreed Scope:
          </span>

          <p
            style={{
              marginTop: '4px',
              color: '#1e293b',
              fontWeight: 500
            }}
          >
            {description || 'Scope work details.'}
          </p>
        </div>

        {(photoData1 || photoData2) && (
          <div
            style={{
              marginTop: '8px',
              paddingTop: '8px',
              borderTop: '1px solid #e2e8f0'
            }}
          >
            <span
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '10px',
                fontWeight: 800,
                color: '#64748b',
                textTransform: 'uppercase'
              }}
            >
              Site Condition Photos:
            </span>

            <div
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'center'
              }}
            >
              {photoData1 && (
                <img
                  src={photoData1}
                  alt="Site 1"
                  style={{
                    maxHeight: '110px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1'
                  }}
                />
              )}

              {photoData2 && (
                <img
                  src={photoData2}
                  alt="Site 2"
                  style={{
                    maxHeight: '110px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1'
                  }}
                />
              )}
            </div>
          </div>
        )}

        <div className="summary-total">
          <span>Authorized Total:</span>
          <span>${cost || '0.00'}</span>
        </div>
      </div>

      <div
        style={{
          marginBottom: '14px',
          padding: '12px',
          border: '1px solid #cbd5e1',
          borderRadius: '12px',
          background: '#f8fafc'
        }}
      >
        {!clientResponseMode ? (
          <>
            <p
              style={{
                color: '#475569',
                fontSize: '12px',
                fontWeight: 700,
                marginBottom: '9px'
              }}
            >
              Not ready to authorize this order?
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px'
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setClientResponseMode('changes_requested');
                  setClientResponseNote('');
                }}
                style={{
                  padding: '10px',
                  borderRadius: '9px',
                  border: '1px solid #38bdf8',
                  background: '#f0f9ff',
                  color: '#0369a1',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                ✎ Request Changes
              </button>

              <button
                type="button"
                onClick={() => {
                  setClientResponseMode('declined');
                  setClientResponseNote('');
                }}
                style={{
                  padding: '10px',
                  borderRadius: '9px',
                  border: '1px solid #fca5a5',
                  background: '#fff7f7',
                  color: '#b91c1c',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Decline Order
              </button>
            </div>
          </>
        ) : (
          <>
            <label
              htmlFor="clientResponseNote"
              style={{
                display: 'block',
                marginBottom: '6px',
                color: '#334155',
                fontSize: '12px',
                fontWeight: 800
              }}
            >
              {clientResponseMode === 'changes_requested'
                ? 'What should the contractor change?'
                : 'Reason for declining (optional)'}
            </label>

            <textarea
              id="clientResponseNote"
              value={clientResponseNote}
              onChange={(e) => setClientResponseNote(e.target.value)}
              placeholder={
                clientResponseMode === 'changes_requested'
                  ? 'Describe the requested correction or revision…'
                  : 'You may explain why you are declining this order…'
              }
              rows={4}
              style={{
                background: '#ffffff',
                color: '#0f172a',
                borderColor: '#cbd5e1',
                resize: 'vertical'
              }}
            />

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '8px',
                marginTop: '8px'
              }}
            >
              <button
                type="button"
                disabled={isSubmittingClientResponse}
                onClick={() => {
                  setClientResponseMode(null);
                  setClientResponseNote('');
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: '9px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: isSubmittingClientResponse
                    ? 'not-allowed'
                    : 'pointer'
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={
                  isSubmittingClientResponse ||
                  (
                    clientResponseMode === 'changes_requested' &&
                    !clientResponseNote.trim()
                  )
                }
                onClick={() =>
                  void handleClientResponse(clientResponseMode)
                }
                style={{
                  padding: '10px 12px',
                  borderRadius: '9px',
                  border: 'none',
                  background:
                    clientResponseMode === 'changes_requested'
                      ? '#0284c7'
                      : '#dc2626',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 800,
                  opacity:
                    isSubmittingClientResponse ||
                    (
                      clientResponseMode === 'changes_requested' &&
                      !clientResponseNote.trim()
                    )
                      ? 0.55
                      : 1,
                  cursor:
                    isSubmittingClientResponse ||
                    (
                      clientResponseMode === 'changes_requested' &&
                      !clientResponseNote.trim()
                    )
                      ? 'not-allowed'
                      : 'pointer'
                }}
              >
                {isSubmittingClientResponse
                  ? 'Recording Response…'
                  : clientResponseMode === 'changes_requested'
                    ? 'Submit Requested Changes'
                    : 'Confirm Decline'}
              </button>
            </div>
          </>
        )}
      </div>

      {!clientResponseMode && (
        <>
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '10px 12px',
              marginBottom: '12px'
            }}
          >
            <div style={{ marginBottom: '12px' }}>
              <label
                htmlFor="signerName"
                style={{
                  display: 'block',
                  marginBottom: '5px',
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#475569'
                }}
              >
                Signer’s full legal name
              </label>

              <input
                id="signerName"
                type="text"
                autoComplete="name"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Enter your full name"
                style={{
                  background: '#ffffff',
                  color: '#0f172a',
                  borderColor: '#cbd5e1'
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px'
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
                  cursor: 'pointer'
                }}
              />

              <label
                htmlFor="legalAgree"
                style={{
                  fontSize: '11px',
                  color: '#475569',
                  lineHeight: '1.4',
                  cursor: 'pointer'
                }}
              >
                <strong>Electronic consent:</strong> {CONSENT_TEXT}
              </label>
            </div>

            <details
              style={{
                marginTop: '10px',
                fontSize: '11px',
                color: '#475569',
                lineHeight: '1.45'
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 800
                }}
              >
                Review authorization and payment terms
              </summary>

              <p style={{ marginTop: '7px' }}>
                {orderTerms ||
                  profile.customTerms ||
                  DEFAULT_TERMS}
              </p>
            </details>
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <label
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#334155'
                }}
              >
                Sign with finger or stylus:
              </label>

              <button
                type="button"
                onClick={clearCanvas}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                ↺ Clear
              </button>
            </div>

            <div
              className="canvas-wrapper"
              style={{ touchAction: 'none' }}
            >
              <canvas
                ref={canvasRef}
                width={340}
                height={120}
                style={{ touchAction: 'none' }}
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
              marginTop: '14px'
            }}
          >
            {orderRequirePaymentUpfront &&
              orderPaymentsEnabled && (
                <button
                  type="button"
                  onClick={() => finalizeSignatureAndPay(true)}
                  disabled={
                    !acceptedTerms ||
                    !hasSignature ||
                    !signerName.trim()
                  }
                  style={{
                    width: '100%',
                    background: '#0f172a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '15px',
                    fontWeight: 800,
                    cursor:
                      acceptedTerms &&
                      hasSignature &&
                      signerName.trim()
                        ? 'pointer'
                        : 'not-allowed',
                    opacity:
                      acceptedTerms &&
                      hasSignature &&
                      signerName.trim()
                        ? 1
                        : 0.6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  💳 Sign & Pay Now with Stripe ($
                  {cost || '0.00'})
                </button>
              )}

            <button
              type="button"
              onClick={() => finalizeSignatureAndPay(false)}
              disabled={
                !acceptedTerms ||
                !hasSignature ||
                !signerName.trim()
              }
              className="btn-approve"
              style={{
                opacity:
                  acceptedTerms &&
                  hasSignature &&
                  signerName.trim()
                    ? 1
                    : 0.6,
                cursor:
                  acceptedTerms &&
                  hasSignature &&
                  signerName.trim()
                    ? 'pointer'
                    : 'not-allowed',
                marginTop: 0
              }}
            >
              ✓ Authorize Scope (Pay Later / On Invoice)
            </button>
          </div>
        </>
      )}
    </div>
  )
)}                 
              
        {/* VIEW 3: LOCKED RECEIPT */}
        {view === 'signed_receipt' && (
          <div className="card-dark" style={{ textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto', fontSize: '20px', fontWeight: 800 }}>
              ✓
            </div>

            <h2 style={{ fontSize: '18px', fontWeight: 800 }}>Document Authorized & Locked</h2>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
              {paymentStatus === 'paid' ? 'Payment confirmed and the authorization is secured.' : paymentStatus === 'pending' ? 'Authorization saved. Complete payment in the Stripe window.' : 'Authorization saved securely.'}
            </p>

            <div style={{ background: '#0b1120', borderRadius: '12px', padding: '14px', margin: '16px 0', textAlign: 'left', border: '1px solid #1e293b', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Type:</span>
                <strong>{orderType}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Contractor:</span>
                <strong>{orderContractorName || profile.companyName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Client:</span>
                <strong>{clientName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Amount:</span>
                <strong style={{ color: '#34d399' }}>${cost}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>Payment:</span>
                <strong style={{ color: paymentStatus === 'paid' ? '#38bdf8' : '#f59e0b' }}>
                  {paymentStatus === 'paid' ? 'Paid via Stripe' : paymentStatus === 'pending' ? 'Awaiting Stripe confirmation' : 'Invoice due'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Timestamp:</span>
                <span style={{ fontFamily: 'monospace' }}>{signTimestamp}</span>
              </div>
              {signatureData && (
                <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #1e293b' }}>
                  <span style={{ color: '#64748b', display: 'block', marginBottom: '4px' }}>Captured Signature:</span>
                  <div style={{ background: '#ffffff', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
                    <img src={signatureData} alt="Client Signature" style={{ maxHeight: '45px' }} />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
              {paymentStatus === 'pending' && orderPaymentsEnabled && (
                <button
                  type="button"
                  onClick={() => void openSecureCheckout().catch(() => alert('Secure payment could not open. Please try again.'))}
                  style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#38bdf8', color: '#0f172a', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
                >
                  💳 Continue to Secure Payment
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: '#f59e0b', color: '#0f172a', fontSize: '13px', fontWeight: 800, cursor: 'pointer' }}
              >
                📄 Open / Download Signed Authorization PDF
              </button>

              {!isClientMode && (
                <button 
                  type="button" 
                  onClick={() => { fetchDashboardOrders(); setView('dashboard'); }} 
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
