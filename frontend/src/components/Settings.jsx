import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Plus, Trash2 } from 'lucide-react';

const API_BASE = '/api';

function Settings() {
  const [settings, setSettings] = useState({
    openrouter_key: '',
    ai_model: 'google/gemini-2.5-flash',
    downloader_url: '',
    navidrome_library_path: '/music',
    auto_download: 'true'
  });
  
  const [accounts, setAccounts] = useState([]);
  const [models, setModels] = useState([]);
  const [newAccount, setNewAccount] = useState({ url: '', username: '', password_or_token: '', salt: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [settingsRes, accountsRes, modelsRes] = await Promise.all([
        axios.get(`${API_BASE}/settings`),
        axios.get(`${API_BASE}/accounts`),
        axios.get(`${API_BASE}/models`)
      ]);
      
      setSettings(prev => ({...prev, ...settingsRes.data}));
      setAccounts(accountsRes.data);
      setModels(modelsRes.data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSettingChange = (e) => {
    setSettings({...settings, [e.target.name]: e.target.value});
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Save all settings sequentially or Promise.all
      const promises = Object.entries(settings).map(([key, value]) => {
        return axios.post(`${API_BASE}/settings`, { key, value });
      });
      await Promise.all(promises);
      setMsg('Settings saved successfully!');
      
      // Refetch models in case API key changed
      const modelsRes = await axios.get(`${API_BASE}/models`);
      setModels(modelsRes.data);

      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      console.error(err);
      setMsg('Error saving settings.');
    } finally {
      setSaving(false);
    }
  };

  const addAccount = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/accounts`, newAccount);
      setNewAccount({ url: '', username: '', password_or_token: '', salt: '' });
      fetchData(); // refresh list
    } catch (err) {
      console.error(err);
    }
  };

  const removeAccount = async (id) => {
    try {
      await axios.delete(`${API_BASE}/accounts/${id}`);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="animate-fade-in" style={{maxWidth: '850px', margin: '0 auto'}}>
      <h1 style={{fontSize: '2.2rem', fontWeight: '800', marginBottom: '2.5rem', letterSpacing: '-0.5px'}}>Configuration</h1>
      
      {msg && (
        <div style={{padding: '1.2rem', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success-color)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '12px', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '10px'}}>
          <Save size={18} /> {msg}
        </div>
      )}

      <form onSubmit={saveSettings} className="glass-panel" style={{padding: '2.5rem', marginBottom: '3rem'}}>
        <div className="settings-section" style={{marginBottom: 0, padding: 0}}>
          <h2>General Settings</h2>
          
          <div className="form-group">
            <label>OpenRouter API Key</label>
            <input 
              type="password" 
              name="openrouter_key" 
              value={settings.openrouter_key || ''} 
              onChange={handleSettingChange} 
              className="glass-input" 
              placeholder="sk-or-..." 
            />
          </div>

          <div className="form-group">
            <label>AI Model</label>
            {models.length > 0 ? (
              <select 
                name="ai_model" 
                value={settings.ai_model || ''} 
                onChange={handleSettingChange} 
                className="glass-input"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.name || m.id}</option>
                ))}
              </select>
            ) : (
              <input 
                type="text" 
                name="ai_model" 
                value={settings.ai_model || ''} 
                onChange={handleSettingChange} 
                className="glass-input" 
                placeholder="Enter model ID or save API key to load..."
              />
            )}
          </div>

          <div className="form-group">
            <label>Downloader API URL</label>
            <input 
              type="text" 
              name="downloader_url" 
              value={settings.downloader_url || ''} 
              onChange={handleSettingChange} 
              className="glass-input" 
              placeholder="http://downloader:8080" 
            />
          </div>

          <div className="form-group">
            <label>Navidrome Library Mount Path (Internal Docker path)</label>
            <input 
              type="text" 
              name="navidrome_library_path" 
              value={settings.navidrome_library_path || ''} 
              onChange={handleSettingChange} 
              className="glass-input" 
            />
          </div>

          <div className="form-group" style={{ display: 'flex', gap: '1.5rem' }}>
            <div style={{ flex: 1 }}>
              <label>Max AI Recommendations</label>
              <input 
                type="number" 
                name="max_recommendations" 
                value={settings.max_recommendations || '5'} 
                onChange={handleSettingChange} 
                className="glass-input" 
                min="1"
                max="50"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Auto-queue Downloads</label>
              <select 
                name="auto_download" 
                value={settings.auto_download || 'true'} 
                onChange={handleSettingChange}
                className="glass-input"
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </div>
        </div>
        
        <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className={`glass-button primary ${saving ? 'btn-pulse' : ''}`} disabled={saving}>
            <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      <div className="glass-panel" style={{padding: '2.5rem', marginBottom: '3rem'}}>
        <div className="settings-section" style={{marginBottom: 0, padding: 0}}>
          <h2>Navidrome Accounts</h2>
          <p style={{color: 'var(--text-secondary)', marginBottom: '2rem'}}>
            Add multiple accounts to fetch recently played tracks from different users.
          </p>
          
          <div style={{marginBottom: '2.5rem'}}>
            {accounts.length === 0 ? (
              <p style={{color: 'var(--text-muted)', fontStyle: 'italic', padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', textAlign: 'center'}}>No accounts added yet.</p>
            ) : (
              <ul style={{listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem'}}>
                {accounts.map(acc => (
                  <li key={acc.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '12px', transition: 'var(--transition)'}}>
                    <div>
                      <strong style={{fontSize: '1.1rem'}}>{acc.username}</strong> 
                      <span style={{color: 'var(--text-muted)', marginLeft: '8px'}}>@ {acc.url}</span>
                    </div>
                    <button onClick={() => removeAccount(acc.id)} className="glass-button danger" style={{padding: '8px 12px'}}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={addAccount} style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)'}}>
            <div className="form-group" style={{marginBottom: 0}}>
              <label>Navidrome URL</label>
              <input type="text" value={newAccount.url} onChange={e => setNewAccount({...newAccount, url: e.target.value})} className="glass-input" required placeholder="https://music.example.com" />
            </div>
            <div className="form-group" style={{marginBottom: 0}}>
              <label>Username</label>
              <input type="text" value={newAccount.username} onChange={e => setNewAccount({...newAccount, username: e.target.value})} className="glass-input" required />
            </div>
            <div className="form-group" style={{marginBottom: 0}}>
              <label>Password or API Token</label>
              <input type="password" value={newAccount.password_or_token} onChange={e => setNewAccount({...newAccount, password_or_token: e.target.value})} className="glass-input" required />
            </div>
            <div className="form-group" style={{marginBottom: 0}}>
              <label>Salt (Optional)</label>
              <input type="text" value={newAccount.salt} onChange={e => setNewAccount({...newAccount, salt: e.target.value})} className="glass-input" placeholder="For plaintext leave empty" />
            </div>
            <div style={{gridColumn: '1 / -1', marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end'}}>
              <button type="submit" className="glass-button">
                <Plus size={18} /> Add Account
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default Settings;
