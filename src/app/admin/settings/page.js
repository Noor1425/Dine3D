'use client';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAdminAccess } from '@/components/auth/AdminAccessContext';

/** Enough coverage for the region Dine3D sells into, without a 400-entry list. */
const TIMEZONE_OPTIONS = [
  'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'Asia/Dhaka',
  'Asia/Kabul', 'Asia/Tehran', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Muscat',
  'Asia/Singapore', 'Asia/Jakarta', 'Europe/London', 'America/New_York', 'UTC',
];

/**
 * Every field the settings page edits and the customer menu reads.
 *
 * A theme coming back from the API is merged onto this, so each colour input
 * always has a string to show. Without it a field the server does not send
 * renders as value={undefined} — an uncontrolled input — and React warns the
 * moment the operator picks a premade theme and it becomes defined.
 *
 * These values match the fallbacks in useTheme.js, so an unset field looks the
 * same here as it does on the live menu.
 */
const THEME_DEFAULTS = {
  primaryColor: '#FF6B35',
  secondaryColor: '#1A1A2E',
  accentColor: '#F7C948',
  backgroundColor: '#FFFFFF',
  textColor: '#1A1A2E',
  fontFamily: 'Inter',
  headingFont: 'Outfit',
  layoutTemplate: 'grid',
  borderRadius: '12px',
  offerText: '',
};

/** Fill in anything the server left out, so the form is always controlled. */
const completeTheme = (incoming) => {
  const merged = { ...THEME_DEFAULTS, ...(incoming || {}) };
  Object.entries(THEME_DEFAULTS).forEach(([key, fallback]) => {
    if (merged[key] === null || merged[key] === undefined) merged[key] = fallback;
  });
  return merged;
};

const FONT_OPTIONS = ['Inter', 'Outfit', 'DM Sans', 'Playfair Display', 'Roboto', 'Poppins', 'Lora', 'Montserrat', 'Space Grotesk', 'Georgia'];
const LAYOUT_OPTIONS = [
  { value: 'grid', icon: '▦', name: 'Grid', desc: 'Card grid layout' },
  { value: 'list', icon: '☰', name: 'List', desc: 'Detailed list view' },
  { value: 'carousel', icon: '⏭', name: 'Carousel', desc: 'Horizontal scroll' },
];

const CURRENCY_OPTIONS = [
  { code: 'PKR', symbol: 'Rs.', name: 'Pakistani Rupee' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'SAR', symbol: 'SR', name: 'Saudi Riyal' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
];

const PREMADE_THEMES = [
  {
    id: 'apple-dark',
    name: 'Midnight Noir',
    desc: 'Cinematic, ultra-modern dark mode',
    theme: {
      primaryColor: '#ffffff',
      secondaryColor: '#1a1a1a',
      accentColor: '#3b82f6',
      backgroundColor: '#000000',
      textColor: '#ffffff',
      fontFamily: 'Inter',
      headingFont: 'Outfit',
      layoutTemplate: 'grid',
      borderRadius: '2rem'
    }
  },
  {
    id: 'apple-light',
    name: 'Clean Minimalist',
    desc: 'Bright, airy, and highly readable',
    theme: {
      primaryColor: '#000000',
      secondaryColor: '#f3f4f6',
      accentColor: '#10b981',
      backgroundColor: '#ffffff',
      textColor: '#111827',
      fontFamily: 'Inter',
      headingFont: 'Inter',
      layoutTemplate: 'grid',
      borderRadius: '1.5rem'
    }
  },
  {
    id: 'sakura',
    name: 'Sakura Blush',
    desc: 'Soft, elegant, and warm',
    theme: {
      primaryColor: '#ec4899',
      secondaryColor: '#fce7f3',
      accentColor: '#fb7185',
      backgroundColor: '#fffdfd',
      textColor: '#1f2937',
      fontFamily: 'Outfit',
      headingFont: 'Playfair Display',
      layoutTemplate: 'grid',
      borderRadius: '1.5rem'
    }
  },
  {
    id: 'ocean',
    name: 'Ocean Fine Dining',
    desc: 'Deep blue sophistication',
    theme: {
      primaryColor: '#e0f2fe',
      secondaryColor: '#0c4a6e',
      accentColor: '#38bdf8',
      backgroundColor: '#082f49',
      textColor: '#f0f9ff',
      fontFamily: 'DM Sans',
      headingFont: 'DM Sans',
      layoutTemplate: 'list',
      borderRadius: '1.5rem'
    }
  },
  {
    id: 'sunset',
    name: 'Golden Hour',
    desc: 'Warm, rustic, and inviting',
    theme: {
      primaryColor: '#f59e0b',
      secondaryColor: '#fffbeb',
      accentColor: '#d97706',
      backgroundColor: '#fafafa',
      textColor: '#451a03',
      fontFamily: 'Lora',
      headingFont: 'Georgia',
      layoutTemplate: 'grid',
      borderRadius: '1rem'
    }
  }
];

export default function SettingsPage() {
  const { can } = useAdminAccess();
  const canReadTheme = can('theme.read');
  const canWriteTheme = can('theme.write');
  const canReadProfile = can('settings.read');
  const canWriteProfile = can('settings.profile');
  const canManageBillingSettings = can('settings.billing');
  const availableTabs = [
    canReadTheme && { id: 'theme', icon: '🎨', label: 'Theme' },
    canReadProfile && { id: 'profile', icon: '🏪', label: 'Profile' },
    canReadProfile && { id: 'operations', icon: '⚙️', label: 'Operations' },
    canManageBillingSettings && { id: 'billing', icon: '💰', label: 'Billing' },
    canManageBillingSettings && { id: 'fbr', icon: '🧾', label: 'FBR Invoicing' },
    // No permission gate: this changes the signed-in person's own password, and
    // a restaurant handed a temporary password had no way to replace it.
    { id: 'security', icon: '🔒', label: 'Security' },
  ].filter(Boolean);
  const [theme, setTheme] = useState(null);
  const [restaurant, setRestaurant] = useState(null);
  // FBR digital invoicing. `fbrForm.fbrToken` stays empty unless the operator
  // is entering a new one — the stored token is never sent back to the browser,
  // so an empty field means "leave it alone", not "clear it".
  const [fbr, setFbr] = useState(null);
  const [fbrForm, setFbrForm] = useState({
    fbrMode: 'SANDBOX', fbrNtnCnic: '', fbrBusinessName: '',
    fbrProvince: '', fbrAddress: '', fbrScenarioId: '', fbrToken: '',
  });
  const [fbrTesting, setFbrTesting] = useState(false);
  const [fbrTestResult, setFbrTestResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(availableTabs[0]?.id || 'theme');
  const [profileForm, setProfileForm] = useState({ name: '', phone: '', address: '', description: '', currency: 'PKR' });
  /**
   * Settings that change how the product behaves rather than how it looks.
   * Every one of these was already read somewhere in the system — the tax
   * number is printed on every receipt — and none of them could be set.
   */
  const [operations, setOperations] = useState({
    taxRegistrationNumber: '',
    receiptFooter: '',
    orderPrefix: 'ORD',
    timezone: 'Asia/Karachi',
    lowStockThreshold: 10,
    menuPublished: true,
    tipEnabled: false,
    isKitchenEnabled: true,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [billingSettings, setBillingSettings] = useState(null);
  const [billingForm, setBillingForm] = useState({ taxPercent: 5, taxMode: 'EXCLUSIVE', serviceChargePercent: 0, serviceFeeFixed: 50 });

  useEffect(() => { loadData(); }, []);

  const saveFbr = async (overrides = {}) => {
    setSaving(true);
    setFbrTestResult(null);
    try {
      // An empty token field means "keep the one you have", so it is only sent
      // when the operator has actually typed a new one.
      const payload = { ...fbrForm, ...overrides };
      if (!payload.fbrToken) delete payload.fbrToken;

      const updated = await api.updateFbrSettings(payload);
      setFbr((previous) => ({ ...previous, ...updated }));
      setFbrForm((previous) => ({ ...previous, ...overrides, fbrToken: '' }));
      toast.success(
        overrides.fbrEnabled === true ? 'FBR reporting is on.'
          : overrides.fbrEnabled === false ? 'FBR reporting is off.'
            : 'FBR settings saved.',
      );
    } catch (error) {
      toast.error(error.message || 'Could not save FBR settings.');
    } finally {
      setSaving(false);
    }
  };

  const testFbr = async () => {
    setFbrTesting(true);
    setFbrTestResult(null);
    try {
      const result = await api.testFbrConnection();
      setFbrTestResult(result);
      if (result.ok) toast.success('FBR accepted the test invoice.');
      else toast.error(result.error || 'FBR rejected the test.');
    } catch (error) {
      setFbrTestResult({ ok: false, error: error.message });
      toast.error(error.message || 'Could not reach FBR.');
    } finally {
      setFbrTesting(false);
    }
  };

  const loadData = async () => {
    try {
      setLoadError(null);
      // Only the restaurant itself is required to render the page. The rest are
      // per-tab, so one of them failing hides that tab's data instead of
      // leaving the operator on a blank page with nothing to act on.
      const [themeRes, meRes, billingRes, fbrRes] = await Promise.all([
        canReadTheme ? api.getTheme().catch(() => null) : Promise.resolve(null),
        api.getMe(),
        canManageBillingSettings ? api.getBillingSettings().catch(() => null) : Promise.resolve(null),
        canManageBillingSettings ? api.getFbrSettings().catch(() => null) : Promise.resolve(null),
      ]);
      if (themeRes?.theme) setTheme(completeTheme(themeRes.theme));
      setRestaurant(meRes.restaurant);
      if (billingRes?.billingSettings) {
        setBillingSettings(billingRes.billingSettings);
        setBillingForm({
          taxPercent: billingRes.billingSettings.tax.percent,
          taxMode: billingRes.billingSettings.tax.mode || 'EXCLUSIVE',
          serviceChargePercent: billingRes.billingSettings.serviceCharge.percent,
          serviceFeeFixed: billingRes.billingSettings.serviceFee.fixed
        });
      }
      if (fbrRes) {
        setFbr(fbrRes);
        setFbrForm({
          fbrMode: fbrRes.fbrMode || 'SANDBOX',
          fbrNtnCnic: fbrRes.fbrNtnCnic || '',
          fbrBusinessName: fbrRes.fbrBusinessName || '',
          fbrProvince: fbrRes.fbrProvince || '',
          fbrAddress: fbrRes.fbrAddress || '',
          fbrScenarioId: fbrRes.fbrScenarioId || '',
          fbrToken: '',
        });
      }
      setProfileForm({
        name: meRes.restaurant.name,
        phone: meRes.restaurant.phone || '',
        address: meRes.restaurant.address || '',
        description: meRes.restaurant.description || '',
        currency: meRes.restaurant.currency || 'PKR',
      });
      setOperations({
        taxRegistrationNumber: meRes.restaurant.taxRegistrationNumber || '',
        receiptFooter: meRes.restaurant.receiptFooter || '',
        orderPrefix: meRes.restaurant.orderPrefix || 'ORD',
        timezone: meRes.restaurant.timezone || 'Asia/Karachi',
        lowStockThreshold: Number(meRes.restaurant.lowStockThreshold ?? 10),
        menuPublished: meRes.restaurant.menuPublished !== false,
        tipEnabled: meRes.restaurant.tipEnabled === true,
        isKitchenEnabled: meRes.restaurant.isKitchenEnabled !== false,
      });
    } catch (err) {
      // This used to be console.error alone: settings simply came up empty and
      // nothing said why.
      setLoadError(err.message || 'Your settings could not be loaded.');
      toast.error(err.message || 'Your settings could not be loaded.');
    } finally { setLoading(false); }
  };

  const showSavedFeedback = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleSaveTheme = async () => {
    setSaving(true);
    try {
      await api.updateTheme(theme);
      toast.success('Settings saved successfully');
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleResetTheme = async () => {
    if (!confirm('Reset theme to defaults?')) return;
    try {
      const res = await api.resetTheme();
      setTheme(completeTheme(res.theme));
      toast.success('Theme reset to defaults');
    } catch (err) { toast.error(err.message); }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('name', profileForm.name);
      formData.append('phone', profileForm.phone);
      formData.append('address', profileForm.address);
      formData.append('description', profileForm.description);
      formData.append('currency', profileForm.currency);
      if (logoFile) formData.append('logo', logoFile);
      const res = await api.put('/auth/profile', formData);
      setRestaurant(res.restaurant);
      localStorage.setItem('dine3d_restaurant', JSON.stringify(res.restaurant));
      toast.success('Profile saved successfully');
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  /**
   * Operational settings go through the same profile endpoint, because they are
   * the same record and the same permission. Sent as form fields to match the
   * multipart route, so booleans travel as strings and the server parses them.
   */
  const handleSaveOperations = async () => {
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('taxRegistrationNumber', operations.taxRegistrationNumber);
      formData.append('receiptFooter', operations.receiptFooter);
      formData.append('orderPrefix', operations.orderPrefix);
      formData.append('timezone', operations.timezone);
      formData.append('lowStockThreshold', String(operations.lowStockThreshold));
      formData.append('menuPublished', String(operations.menuPublished));
      formData.append('tipEnabled', String(operations.tipEnabled));
      formData.append('isKitchenEnabled', String(operations.isKitchenEnabled));
      const res = await api.put('/auth/profile', formData);
      setRestaurant(res.restaurant);
      toast.success('Operational settings saved');
      showSavedFeedback();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Changing a password signs every device out, including this one.
   *
   * The API revokes all refresh tokens and clears the session cookie, which is
   * the correct behaviour — a password is usually changed because the old one
   * is no longer trusted, and leaving other sessions alive defeats that. So the
   * screen says it before the button is pressed and sends the operator to the
   * sign-in page afterwards rather than letting them discover it on the next
   * request.
   */
  const handleChangePassword = async () => {
    const { currentPassword, newPassword, confirmPassword } = passwordForm;
    if (!currentPassword) return toast.error('Enter your current password');
    if (newPassword !== confirmPassword) return toast.error('The two new passwords do not match');
    if (Array.from(newPassword).length < 15) return toast.error('Use at least 15 characters');

    setChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed. Signing you in again…');
      setTimeout(() => { window.location.href = '/admin/login?reason=password_changed'; }, 1400);
    } catch (err) {
      toast.error(err.message || 'That password could not be changed.');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSaveBillingSettings = async () => {
    setSaving(true);
    try {
      const res = await api.updateBillingSettings(billingForm);
      setBillingSettings(res.billingSettings);
      toast.success('Billing settings updated successfully');
      showSavedFeedback();
    } catch (err) { 
      toast.error(err.message); 
    }
    finally { setSaving(false); }
  };

  const colorFields = [
    { key: 'primaryColor', label: 'Primary' },
    { key: 'secondaryColor', label: 'Secondary' },
    { key: 'accentColor', label: 'Accent' },
    { key: 'backgroundColor', label: 'Background' },
    { key: 'textColor', label: 'Text' },
  ];

  if (loading) return (
    <div>
      <div className="page-header"><div className="skeleton skeleton-heading" /></div>
      <div className="skeleton skeleton-card" style={{height:500}} />
    </div>
  );

  if (loadError) return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Your settings could not be loaded</div>
        <div className="form-hint" style={{ marginBottom: 18 }}>{loadError}</div>
        <button
          className="btn btn-primary"
          onClick={() => { setLoading(true); loadData(); }}
        >
          Try again
        </button>
      </div>
    </div>
  );

  return (
    <div>
      {/* Save toast */}
      {saved && (
        <div style={{
          position: 'fixed', top: 24, right: 24, zIndex: 9999,
          padding: '14px 24px', borderRadius: 16,
          background: 'linear-gradient(135deg, #065F46, #047857)',
          color: 'white', fontWeight: 600, fontSize: 14,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
          animation: 'toastIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ✓ Settings saved successfully
        </div>
      )}

      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="page-header-subtitle">Customize your restaurant&apos;s appearance and profile</div>
        </div>
      </div>

      <div className="settings-tabs">
        {availableTabs.map(tab => (
          <button key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* The theme is fetched separately, so say so when it is the one thing
          that did not arrive rather than showing an empty panel. */}
      {activeTab === 'theme' && canReadTheme && !theme && (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Your branding could not be loaded</div>
          <div className="form-hint" style={{ marginBottom: 18 }}>Everything else on this page is unaffected.</div>
          <button className="btn btn-secondary" onClick={loadData}>Try again</button>
        </div>
      )}

      {activeTab === 'theme' && canReadTheme && theme && (
        <div className="card animate-in">
          <div className="card-body" style={{padding:32}}>
            <h3 style={{marginBottom:8}}>Theme Customization</h3>
            <p style={{fontSize:14, color:'var(--color-text-muted)', marginBottom:28}}>
              Personalize how your customers see your menu.
            </p>

            {/* Pre-made Themes */}
            <div style={{fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-muted)', marginBottom:16}}>
              Curated Designer Aesthetics
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '32px'
            }}>
              {PREMADE_THEMES.map(preset => (
                <div key={preset.id} onClick={() => setTheme({ ...theme, ...preset.theme, offerText: theme.offerText })} style={{
                  border: '1px solid var(--color-border)', borderRadius: '16px', padding: '16px', cursor: 'pointer',
                  background: 'var(--color-surface)', transition: 'all 0.2s',
                  display: 'flex', gap: '16px', alignItems: 'center'
                }}
                className="hover-card">
                  <div style={{
                    width: '60px', height: '60px', borderRadius: '12px', background: preset.theme.backgroundColor,
                    display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden',
                    border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0
                  }}>
                    <div style={{ height: '30px', background: preset.theme.primaryColor, width: '100%' }} />
                    <div style={{ display: 'flex', gap: '4px', padding: '0 4px', height: '26px' }}>
                      <div style={{ flex: 1, background: preset.theme.secondaryColor, borderRadius: '4px' }} />
                      <div style={{ flex: 1, background: preset.theme.accentColor, borderRadius: '4px' }} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--color-text)', marginBottom: '4px' }}>{preset.name}</div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>{preset.desc}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', background: 'var(--color-bg-muted)', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '12px' }}>✨</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Colors */}
            <div style={{fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-muted)', marginBottom:16}}>
              Manual Color Override
            </div>
            <div className="color-picker-group">
              {colorFields.map(({key, label}) => (
                <div className="color-picker-item" key={key}>
                  <div className="color-swatch" style={{background: theme[key]}}>
                    <input type="color" value={theme[key]}
                      onChange={e => setTheme({...theme, [key]: e.target.value})} />
                  </div>
                  <div className="color-picker-info">
                    <div className="color-picker-label">{label}</div>
                    <div className="color-picker-value">{theme[key]}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Fonts */}
            <div style={{fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-muted)', marginBottom:16}}>
              Typography
            </div>
            <div className="grid-2" style={{marginBottom:28}}>
              <div className="form-group">
                <label className="form-label">Body Font</label>
                <select className="select" value={theme.fontFamily} onChange={e => setTheme({...theme, fontFamily: e.target.value})}>
                  {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Heading Font</label>
                <select className="select" value={theme.headingFont} onChange={e => setTheme({...theme, headingFont: e.target.value})}>
                  {FONT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>

            {/* Layout */}
            <div style={{fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-muted)', marginBottom:16}}>
              Layout Template
            </div>
            <div className="layout-selector">
              {LAYOUT_OPTIONS.map(opt => (
                <div key={opt.value}
                  className={`layout-option ${theme.layoutTemplate === opt.value ? 'active' : ''}`}
                  onClick={() => setTheme({...theme, layoutTemplate: opt.value})}>
                  <div className="layout-option-icon">{opt.icon}</div>
                  <div className="layout-option-name">{opt.name}</div>
                  <div className="layout-option-desc">{opt.desc}</div>
                </div>
              ))}
            </div>

            {/* Border Radius */}
            <div className="form-group" style={{maxWidth:300, marginBottom:28}}>
              <label className="form-label">Border Radius</label>
              <input className="input" value={theme.borderRadius} onChange={e => setTheme({...theme, borderRadius: e.target.value})} placeholder="12px" />
            </div>

            {/* Offer Banner */}
            <div style={{fontSize:13, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--color-text-muted)', marginBottom:16}}>
              Promotional Banner
            </div>
            <div className="form-group" style={{marginBottom:28}}>
              <label className="form-label">Special Offer Text</label>
              <input className="input" value={theme.offerText || ''} onChange={e => setTheme({...theme, offerText: e.target.value})} placeholder="e.g. 🎉 Eid Special: 20% off all desserts!" />
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>This will appear as a banner at the top of your menu. Leave blank to hide.</div>
            </div>

            {/* Preview */}
            <div className="theme-preview">
              <div className="theme-preview-header">Live Preview</div>
              <div style={{
                padding: 40,
                background: theme.backgroundColor,
                color: theme.textColor,
              }}>
                <h3 style={{fontFamily: theme.headingFont, color: theme.primaryColor, marginBottom: 8, fontSize: 22}}>
                  Your Restaurant Name
                </h3>
                <p style={{fontFamily: theme.fontFamily, marginBottom: 20, fontSize: 14, opacity: 0.7}}>
                  This is how your menu description text will look with the current theme settings applied.
                </p>
                <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
                  <button style={{
                    background: theme.primaryColor, color: 'white', border: 'none',
                    padding: '10px 24px', borderRadius: theme.borderRadius, fontFamily: theme.fontFamily,
                    fontWeight: 600, cursor: 'pointer', fontSize: 14,
                  }}>
                    Add to Cart — $12.99
                  </button>
                  <button style={{
                    background: 'transparent', border: `2px solid ${theme.primaryColor}`,
                    color: theme.primaryColor, padding: '10px 24px', borderRadius: theme.borderRadius,
                    fontFamily: theme.fontFamily, fontWeight: 600, cursor: 'pointer', fontSize: 14,
                  }}>
                    View 3D Model
                  </button>
                </div>
              </div>
            </div>

            <div style={{display:'flex', gap:12}}>
              {canWriteTheme && <button className="btn btn-primary" onClick={handleSaveTheme} disabled={saving}>
                {saving ? 'Saving...' : '✓ Save Theme'}
              </button>}
              {canWriteTheme && <button className="btn btn-ghost" onClick={handleResetTheme}>Reset to Defaults</button>}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'profile' && canReadProfile && (
        <div className="card animate-in">
          <div className="card-body" style={{padding:32}}>
            <h3 style={{marginBottom:8}}>Restaurant Profile</h3>
            <p style={{fontSize:14, color:'var(--color-text-muted)', marginBottom:28}}>
              Update your restaurant&apos;s information visible to customers.
            </p>
            <div className="form-group">
              <label className="form-label">Restaurant Name</label>
              <input className="input" value={profileForm.name} onChange={e => setProfileForm({...profileForm, name: e.target.value})} />
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input className="input" value={profileForm.phone} onChange={e => setProfileForm({...profileForm, phone: e.target.value})} placeholder="+1 555 0123" />
            </div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <textarea className="textarea" value={profileForm.address} onChange={e => setProfileForm({...profileForm, address: e.target.value})} placeholder="123 Main St, City" />
            </div>
            <div className="form-group">
              <label className="form-label">Short Description</label>
              <textarea className="textarea" value={profileForm.description} onChange={e => setProfileForm({...profileForm, description: e.target.value})} placeholder="Authentic Lahori karahi and BBQ, seven days a week." maxLength={500} />
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>Shown to customers on your public menu.</div>
            </div>

            <div style={{marginTop:32, paddingTop:32, borderTop:'1px solid var(--color-border)'}}>
              <h3 style={{marginBottom:8}}>Business Settings</h3>
              <p style={{fontSize:13, color:'var(--color-text-muted)', marginBottom:20}}>Operational configurations for your store.</p>
              
              <div className="form-group" style={{maxWidth:400}}>
                <label className="form-label">Store Currency</label>
                <select className="select" value={profileForm.currency} onChange={e => setProfileForm({...profileForm, currency: e.target.value})}>
                  {CURRENCY_OPTIONS.map(c => (
                    <option key={c.code} value={c.code}>{c.code} ({c.symbol}) — {c.name}</option>
                  ))}
                </select>
                <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                  This will be used for all price displays on your public menu.
                </div>
              </div>
            </div>

            <div style={{marginTop:32, paddingTop:32, borderTop:'1px solid var(--color-border)', maxWidth:400}}>
              <div className="form-group">
                <label className="form-label">Store Logo</label>
                <div style={{display:'flex', alignItems:'center', gap:16, marginBottom:12}}>
                  <div style={{width:64, height:64, borderRadius:12, background:'var(--color-bg-muted)', overflow:'hidden', border:'1px solid var(--color-border)', display:'flex', alignItems:'center', justifyContent:'center'}}>
                    {logoFile ? <img src={URL.createObjectURL(logoFile)} className="w-full h-full object-cover" /> : 
                     restaurant?.logoUrl ? <img src={restaurant.logoUrl} className="w-full h-full object-cover" /> : '🖼️'}
                  </div>
                  <div style={{fontSize:12, color:'var(--color-text-muted)'}}>
                    Recommended: <strong>Square (1:1)</strong><br/>
                    e.g. 512x512px
                  </div>
                </div>
                <input type="file" accept="image/*" onChange={e => setLogoFile(e.target.files[0])} className="input" />
              </div>

            </div>

            {canWriteProfile && <button className="btn btn-primary" style={{marginTop:32}} onClick={handleSaveProfile} disabled={saving}>
              {saving ? 'Saving...' : '✓ Save Profile'}
            </button>}
          </div>
        </div>
      )}

      {activeTab === 'operations' && canReadProfile && (
        <div className="card">
          <div className="card-body">
            <h2 style={{marginBottom:8}}>Operations</h2>
            <p style={{fontSize:13, color:'var(--color-text-muted)', marginBottom:28}}>
              Settings that change how Dine3D behaves — what prints on a receipt, how order numbers read,
              and which business day a sale belongs to.
            </p>

            <h3 style={{fontSize:13, fontWeight:800, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--color-text-muted)', marginBottom:16}}>Receipts</h3>

            <div className="form-group">
              <label className="form-label">Sales tax registration number (NTN / STRN)</label>
              <input
                className="input"
                value={operations.taxRegistrationNumber}
                onChange={e => setOperations({ ...operations, taxRegistrationNumber: e.target.value })}
                placeholder="3520212345678"
                maxLength={50}
              />
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                Printed on every customer receipt. Leave blank if you are not registered.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Receipt footer</label>
              <textarea
                className="textarea"
                value={operations.receiptFooter}
                onChange={e => setOperations({ ...operations, receiptFooter: e.target.value })}
                placeholder="Thank you — see you again!"
                maxLength={500}
              />
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                The last line on the paper. Wi-Fi password, return policy, or a thank you.
              </div>
            </div>

            <div style={{marginTop:32, paddingTop:28, borderTop:'1px solid var(--color-border)'}}>
              <h3 style={{fontSize:13, fontWeight:800, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--color-text-muted)', marginBottom:16}}>Orders</h3>

              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:20}}>
                <div className="form-group">
                  <label className="form-label">Order number prefix</label>
                  <input
                    className="input"
                    value={operations.orderPrefix}
                    onChange={e => setOperations({ ...operations, orderPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })}
                    placeholder="ORD"
                  />
                  <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                    Orders read <strong>{(operations.orderPrefix || 'ORD')}-20260920-MAIN-0042</strong>. Letters and numbers, up to 8.
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <select
                    className="select"
                    value={operations.timezone}
                    onChange={e => setOperations({ ...operations, timezone: e.target.value })}
                  >
                    {TIMEZONE_OPTIONS.map(zone => <option key={zone} value={zone}>{zone}</option>)}
                  </select>
                  <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                    Decides which business day a late-night sale belongs to, and how reports group.
                  </div>
                </div>
              </div>
            </div>

            <div style={{marginTop:32, paddingTop:28, borderTop:'1px solid var(--color-border)'}}>
              <h3 style={{fontSize:13, fontWeight:800, letterSpacing:'0.06em', textTransform:'uppercase', color:'var(--color-text-muted)', marginBottom:16}}>Store</h3>

              <div className="form-group" style={{maxWidth:280}}>
                <label className="form-label">Default low-stock level</label>
                <input
                  type="number"
                  min="0"
                  max="10000"
                  className="input"
                  value={operations.lowStockThreshold}
                  onChange={e => setOperations({ ...operations, lowStockThreshold: e.target.value === '' ? '' : Number(e.target.value) })}
                />
                <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                  Used for new ingredients. Each item can override it.
                </div>
              </div>

              <div style={{display:'flex', flexDirection:'column', gap:14, marginTop:24}}>
                {[
                  { key: 'menuPublished', label: 'Public menu is live', hint: 'Turn off to take the QR menu offline without deleting anything.' },
                  { key: 'isKitchenEnabled', label: 'Kitchen Display is in use', hint: 'Off means orders never wait on a kitchen screen.' },
                  { key: 'tipEnabled', label: 'Ask customers for a tip', hint: 'Adds a tip step at checkout.' },
                ].map(toggle => (
                  <label key={toggle.key} style={{display:'flex', gap:12, alignItems:'flex-start', cursor:'pointer'}}>
                    <input
                      type="checkbox"
                      checked={Boolean(operations[toggle.key])}
                      onChange={e => setOperations({ ...operations, [toggle.key]: e.target.checked })}
                      style={{marginTop:3, width:18, height:18, flex:'0 0 auto', cursor:'pointer'}}
                    />
                    <span>
                      <span style={{fontWeight:700}}>{toggle.label}</span>
                      <span style={{display:'block', fontSize:12, color:'var(--color-text-muted)'}}>{toggle.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {canWriteProfile && (
              <button className="btn btn-primary" style={{marginTop:32}} onClick={handleSaveOperations} disabled={saving}>
                {saving ? 'Saving...' : '\u2713 Save Operations'}
              </button>
            )}
          </div>
        </div>
      )}

      {activeTab === 'security' && (
        <section className="menu-section-shell">
          <div className="menu-section-head">
            <div>
              <div className="menu-section-title">Your password</div>
              <div className="form-hint">
                Changing this signs you out on every device, including this one. You will sign in again with the new password.
              </div>
            </div>
          </div>

          <div className="grid-2" style={{ maxWidth: 720 }}>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label" htmlFor="currentPassword">Current password</label>
              <input
                id="currentPassword"
                className="input"
                type="password"
                autoComplete="current-password"
                value={passwordForm.currentPassword}
                onChange={(event) => setPasswordForm((previous) => ({ ...previous, currentPassword: event.target.value }))}
                placeholder="The password you signed in with"
              />
              <div className="form-hint">
                Asked for because a signed-in screen someone walked away from should not be enough to take the account.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwordForm.newPassword}
                onChange={(event) => setPasswordForm((previous) => ({ ...previous, newPassword: event.target.value }))}
                placeholder="At least 15 characters"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">Repeat new password</label>
              <input
                id="confirmPassword"
                className="input"
                type="password"
                autoComplete="new-password"
                value={passwordForm.confirmPassword}
                onChange={(event) => setPasswordForm((previous) => ({ ...previous, confirmPassword: event.target.value }))}
                placeholder="Type it again"
              />
            </div>
          </div>

          <ul className="form-hint" style={{ maxWidth: 720, marginTop: 4, paddingLeft: 18, lineHeight: 1.8 }}>
            <li>At least 15 characters — a short sentence you will remember works better than a short jumble.</li>
            <li>Not your name, your email, or your restaurant's name.</li>
            <li>Not a password you have used here before.</li>
          </ul>

          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword ? 'Changing…' : 'Change password'}
            </button>
          </div>
        </section>
      )}

      {activeTab === 'fbr' && canManageBillingSettings && fbr && (
        <div className="card animate-in">
          <div className="card-body" style={{padding:32}}>
            <h3 style={{marginBottom:8}}>FBR Digital Invoicing</h3>
            <p style={{fontSize:14, color:'var(--color-text-muted)', marginBottom:24}}>
              Report every sale to the Federal Board of Revenue as it happens, and print the
              FBR invoice number and QR code on your customers&rsquo; receipts. Required for
              Tier-1 retailers and larger restaurants.
            </p>

            {/* What the restaurant has to do themselves, in their own words.
                The token is issued against their NTN, so these four steps
                cannot be done for them — and the owner almost never has IRIS
                credentials, their accountant does. Saying so here saves the
                support call. */}
            <details style={{
              marginBottom:24, borderRadius:12, overflow:'hidden',
              border:'1px solid var(--color-border)', background:'var(--color-surface-2, #F8FAFC)',
            }}>
              <summary style={{
                padding:'14px 20px', cursor:'pointer', fontWeight:700, fontSize:14,
                display:'flex', alignItems:'center', gap:8,
              }}>
                📋 What you need to get from FBR first
              </summary>
              <div style={{padding:'0 20px 20px', fontSize:13.5, lineHeight:1.65, color:'var(--color-text-muted)'}}>
                <p style={{marginBottom:16}}>
                  Your security token is issued against <strong>your own NTN</strong>, so these
                  steps have to be done by you — nobody can do them on your behalf. If you have
                  an accountant who files your tax, they will have the IRIS login and can do
                  this in a few minutes.
                </p>

                {[
                  {
                    n: '1',
                    title: 'Check whether you have to',
                    body: 'FBR requires this from Tier-1 retailers — chain outlets, franchises, shops in air-conditioned malls, and businesses over FBR\u2019s turnover or electricity-bill thresholds, plus larger restaurants. Your accountant will know which you are.',
                  },
                  {
                    n: '2',
                    title: 'Log into IRIS',
                    body: 'Go to iris.fbr.gov.pk and sign in with your NTN. If you have never used it, ask your accountant — they almost certainly have the login.',
                  },
                  {
                    n: '3',
                    title: 'Register for Digital Invoicing',
                    body: 'Inside IRIS, find Digital Invoicing and register. Choose PRAL as your integrator — it is FBR\u2019s own and it is free. Private integrators charge for the same thing.',
                  },
                  {
                    n: '4',
                    title: 'Copy your sandbox token',
                    body: 'IRIS gives you a sandbox token first, for practice. Paste it below with Mode set to Sandbox, and nothing you ring up is filed for real.',
                  },
                  {
                    n: '5',
                    title: 'Practise, then ask for the production token',
                    body: 'Run real orders in sandbox until the Rejected count stays at zero. Then request your production token in IRIS — FBR reviews your business first, so this can take a few days. Start it early.',
                  },
                ].map((step) => (
                  <div key={step.n} style={{display:'flex', gap:12, marginBottom:14}}>
                    <span style={{
                      flex:'none', width:24, height:24, borderRadius:'50%',
                      background:'var(--color-primary, #FF6B35)', color:'#fff',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:12, fontWeight:800,
                    }}>{step.n}</span>
                    <div>
                      <div style={{fontWeight:700, color:'var(--color-text)', marginBottom:2}}>{step.title}</div>
                      <div>{step.body}</div>
                    </div>
                  </div>
                ))}

                <p style={{
                  marginTop:18, paddingTop:14, borderTop:'1px solid var(--color-border)', fontSize:12.5,
                }}>
                  <strong>About your token.</strong> It is stored encrypted and is only ever used to
                  file your own sales. It is never shown again after you save it, and you can
                  revoke it in IRIS at any time.
                </p>
              </div>
            </details>

            {/* The switch. Everything above it is what FBR needs before it will
                accept a single invoice, which is why turning it on is refused
                until those are filled in. */}
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:16,
              padding:'16px 20px', borderRadius:12, marginBottom:24,
              background: fbr.fbrEnabled ? 'rgba(16,185,129,0.08)' : 'var(--color-surface-2, #F8FAFC)',
              border: `1px solid ${fbr.fbrEnabled ? 'rgba(16,185,129,0.35)' : 'var(--color-border)'}`,
            }}>
              <div>
                <div style={{fontWeight:700, fontSize:15}}>
                  {fbr.fbrEnabled ? 'Reporting to FBR' : 'Not reporting to FBR'}
                </div>
                <div style={{fontSize:13, color:'var(--color-text-muted)', marginTop:2}}>
                  {fbr.fbrEnabled
                    ? `Every completed sale is filed in ${fbr.fbrMode === 'PRODUCTION' ? 'live' : 'sandbox'} mode.`
                    : 'Your sales are not being sent anywhere.'}
                </div>
              </div>
              <button
                type="button"
                className={fbr.fbrEnabled ? 'btn' : 'btn btn-primary'}
                disabled={saving}
                onClick={() => saveFbr({ fbrEnabled: !fbr.fbrEnabled })}
                style={{minWidth:120}}
              >
                {saving ? 'Saving…' : fbr.fbrEnabled ? 'Turn off' : 'Turn on'}
              </button>
            </div>

            {fbr.fbrEnabled && (
              <div style={{display:'flex', gap:12, marginBottom:24, flexWrap:'wrap'}}>
                {[
                  { label: 'Reported', value: fbr.counts?.reported ?? 0, tone: '#059669' },
                  { label: 'Waiting to send', value: fbr.counts?.queued ?? 0, tone: '#D97706' },
                  { label: 'Rejected', value: fbr.counts?.failed ?? 0, tone: '#DC2626' },
                ].map((stat) => (
                  <div key={stat.label} style={{
                    flex:'1 1 140px', padding:'12px 16px', borderRadius:10,
                    border:'1px solid var(--color-border)',
                  }}>
                    <div style={{fontSize:12, color:'var(--color-text-muted)'}}>{stat.label}</div>
                    <div style={{fontSize:20, fontWeight:800, color:stat.tone}}>{stat.value}</div>
                  </div>
                ))}
              </div>
            )}

            {fbr.fbrLastError && (
              <div style={{
                padding:'12px 16px', borderRadius:10, marginBottom:24, fontSize:13,
                background:'rgba(220,38,38,0.08)', border:'1px solid rgba(220,38,38,0.3)', color:'#B91C1C',
              }}>
                <strong>FBR last said:</strong> {fbr.fbrLastError}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Mode</label>
              <select
                className="select"
                value={fbrForm.fbrMode}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrMode: e.target.value })}
                style={{maxWidth:280}}
              >
                <option value="SANDBOX">Sandbox — practice, nothing is filed</option>
                <option value="PRODUCTION">Production — real filings</option>
              </select>
              <p style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                Start in sandbox. Your sandbox and production tokens are different — switching
                mode without swapping the token will be rejected.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">NTN or CNIC</label>
              <input
                className="input" style={{maxWidth:280}}
                value={fbrForm.fbrNtnCnic}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrNtnCnic: e.target.value })}
                placeholder="1234567"
              />
              <p style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                7 digits for an NTN, 13 for a CNIC. Must match the one your token was issued against.
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Registered business name</label>
              <input
                className="input"
                value={fbrForm.fbrBusinessName}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrBusinessName: e.target.value })}
                placeholder="As registered with FBR"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Province</label>
              <select
                className="select" style={{maxWidth:320}}
                value={fbrForm.fbrProvince}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrProvince: e.target.value })}
              >
                <option value="">Select your province…</option>
                {(fbr.provinces || []).map((province) => (
                  <option key={province} value={province}>{province}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Business address</label>
              <input
                className="input"
                value={fbrForm.fbrAddress}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrAddress: e.target.value })}
                placeholder="Address on your FBR registration"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Security token {fbr.hasToken ? <span style={{color:'#059669'}}>· saved</span> : null}
              </label>
              <input
                className="input"
                type="password"
                autoComplete="off"
                value={fbrForm.fbrToken}
                onChange={(e) => setFbrForm({ ...fbrForm, fbrToken: e.target.value })}
                placeholder={fbr.hasToken ? 'Leave blank to keep the saved token' : 'Paste the token from IRIS'}
              />
              <p style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                From IRIS &rarr; Digital Invoicing. Stored encrypted and never shown again —
                it can file tax documents in your name.
              </p>
            </div>

            {fbrForm.fbrMode === 'SANDBOX' && (
              <div className="form-group">
                <label className="form-label">Scenario ID (sandbox only)</label>
                <input
                  className="input" style={{maxWidth:200}}
                  value={fbrForm.fbrScenarioId}
                  onChange={(e) => setFbrForm({ ...fbrForm, fbrScenarioId: e.target.value })}
                  placeholder="SN018"
                />
                <p style={{fontSize:12, color:'var(--color-text-muted)', marginTop:6}}>
                  Sandbox asks which scenario you are testing. FBR lists these in IRIS —
                  services in sales-tax mode is the usual one for a restaurant.
                </p>
              </div>
            )}

            {fbrTestResult && (
              <div style={{
                padding:'12px 16px', borderRadius:10, marginBottom:16, fontSize:13,
                background: fbrTestResult.ok ? 'rgba(16,185,129,0.08)' : 'rgba(220,38,38,0.08)',
                border: `1px solid ${fbrTestResult.ok ? 'rgba(16,185,129,0.35)' : 'rgba(220,38,38,0.3)'}`,
                color: fbrTestResult.ok ? '#047857' : '#B91C1C',
              }}>
                {fbrTestResult.ok
                  ? `FBR accepted a test invoice built from ${fbrTestResult.testedWith}. Nothing was filed.`
                  : fbrTestResult.error}
              </div>
            )}

            <div style={{display:'flex', gap:12, marginTop:24, flexWrap:'wrap'}}>
              <button className="btn btn-primary" disabled={saving} onClick={() => saveFbr()}>
                {saving ? 'Saving…' : 'Save FBR settings'}
              </button>
              <button className="btn" disabled={fbrTesting || !fbr.hasToken} onClick={testFbr}>
                {fbrTesting ? 'Checking…' : 'Test connection'}
              </button>
            </div>
            <p style={{fontSize:12, color:'var(--color-text-muted)', marginTop:10}}>
              The test sends one of your real orders to FBR&rsquo;s validation endpoint. It checks
              your token and NTN work — it does not file anything.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'billing' && canManageBillingSettings && billingSettings && (
        <div className="card animate-in">
          <div className="card-body" style={{padding:32}}>
            <h3 style={{marginBottom:8}}>Tax & Billing Settings</h3>
            <p style={{fontSize:14, color:'var(--color-text-muted)', marginBottom:28}}>
              Configure tax rates, service charges, and fees applied to customer orders.
            </p>

            <div className="form-group">
              <label className="form-label">Tax Rate (%)</label>
              <div style={{display:'flex', gap:12, alignItems:'center'}}>
                <input 
                  type="number" 
                  className="input" 
                  value={billingForm.taxPercent} 
                  onChange={e => setBillingForm({...billingForm, taxPercent: parseFloat(e.target.value) || 0})}
                  min="0"
                  max="100"
                  step="0.1"
                  style={{flex:1, maxWidth:200}}
                />
                <span style={{fontSize:13, color:'var(--color-text-muted)', minWidth:150}}>
                  {billingSettings.tax.description}
                </span>
              </div>
              <div style={{display:'flex', gap:12, alignItems:'center', marginTop:12}}>
                <select
                  className="select"
                  value={billingForm.taxMode}
                  onChange={e => setBillingForm({...billingForm, taxMode: e.target.value})}
                  style={{flex:1, maxWidth:200}}
                >
                  <option value="EXCLUSIVE">Exclusive Tax</option>
                  <option value="INCLUSIVE">Inclusive Tax</option>
                </select>
                <span style={{fontSize:13, color:'var(--color-text-muted)', minWidth:150}}>
                  Applied mode: {billingForm.taxMode}
                </span>
              </div>
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:8}}>
                Percentage tax applied to order subtotal. Range: 0-100%
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Service Charge (%)</label>
              <div style={{display:'flex', gap:12, alignItems:'center'}}>
                <input 
                  type="number" 
                  className="input" 
                  value={billingForm.serviceChargePercent} 
                  onChange={e => setBillingForm({...billingForm, serviceChargePercent: parseFloat(e.target.value) || 0})}
                  min="0"
                  max="100"
                  step="0.1"
                  style={{flex:1, maxWidth:200}}
                />
                <span style={{fontSize:13, color:'var(--color-text-muted)', minWidth:150}}>
                  {billingSettings.serviceCharge.description}
                </span>
              </div>
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:8}}>
                Percentage-based service charge. Set to 0 to disable. Range: 0-100%
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Fixed Service Fee ({billingSettings.serviceFee.fixed > 0 ? billingSettings.currency : 'Optional'})</label>
              <div style={{display:'flex', gap:12, alignItems:'center'}}>
                <input 
                  type="number" 
                  className="input" 
                  value={billingForm.serviceFeeFixed} 
                  onChange={e => setBillingForm({...billingForm, serviceFeeFixed: parseFloat(e.target.value) || 0})}
                  min="0"
                  step="1"
                  style={{flex:1, maxWidth:200}}
                />
                <span style={{fontSize:13, color:'var(--color-text-muted)', minWidth:150}}>
                  {billingSettings.serviceFee.description}
                </span>
              </div>
              <div style={{fontSize:12, color:'var(--color-text-muted)', marginTop:8}}>
                Fixed amount charged per order. Set to 0 to disable.
              </div>
            </div>

            <div style={{marginTop:32, padding:20, background:'var(--color-bg-muted)', borderRadius:12, border:'1px solid var(--color-border)'}}>
              <div style={{fontSize:13, fontWeight:600, color:'var(--color-text)', marginBottom:12}}>
                📊 Example Order Calculation:
              </div>
              <div style={{fontSize:13, color:'var(--color-text-muted)', lineHeight:'1.8'}}>
                <div>Order Subtotal: {billingSettings.currency || 'PKR'} 500</div>
                <div>
                  Tax ({billingForm.taxPercent}% · {billingForm.taxMode}): {billingSettings.currency}{' '}
                  {billingForm.taxMode === 'INCLUSIVE'
                    ? (billingForm.taxPercent > 0 ? (500 * billingForm.taxPercent / (100 + billingForm.taxPercent)).toFixed(2) : '0.00')
                    : (500 * billingForm.taxPercent / 100).toFixed(2)}
                </div>
                {billingForm.serviceChargePercent > 0 && (
                  <div>Service Charge ({billingForm.serviceChargePercent}%): {billingSettings.currency} {(500 * billingForm.serviceChargePercent / 100).toFixed(2)}</div>
                )}
                {billingForm.serviceFeeFixed > 0 && (
                  <div>Service Fee: {billingSettings.currency} {billingForm.serviceFeeFixed}</div>
                )}
                <div style={{borderTop:'1px solid var(--color-text-muted)', marginTop:8, paddingTop:8, fontWeight:600}}>
                  Total: {billingSettings.currency}{' '}
                  {(billingForm.taxMode === 'INCLUSIVE'
                    ? 500 + (500 * billingForm.serviceChargePercent / 100) + billingForm.serviceFeeFixed
                    : 500 + (500 * billingForm.taxPercent / 100) + (500 * billingForm.serviceChargePercent / 100) + billingForm.serviceFeeFixed).toFixed(2)}
                </div>
              </div>
            </div>

            <button className="btn btn-primary" style={{marginTop:32}} onClick={handleSaveBillingSettings} disabled={saving}>
              {saving ? 'Saving...' : '✓ Save Billing Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
