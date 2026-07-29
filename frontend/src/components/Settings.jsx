import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Plus, Trash2 } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

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
    <div className="animate-fade-in" style={{maxWidth: '800px', margin: '0 auto'}}>
      <h1 style={{fontSize: '2rem', fontWeight: 'bold', marginBottom: '2rem'}}>Configuration</h1>
      
      {msg && (
        <div style={{padding: '1rem', background: 'rgba(46, 213, 115, 0.2)', color: 'var(--success-color)', borderRadius: '8px', marginBottom: '2rem'}}>
          {msg}
        </div>
      )}

      <form onSubmit={saveSettings} className="glass-panel" style={{padding: '2rem', marginBottom: '3rem'}}>
        <div className="settings-section">
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

          <div className="form-group">
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
        
        <button type="submit" className="glass-button" disabled={saving}>
          <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>

      <div className="glass-panel" style={{padding: '2rem'}}>
        <div className="settings-section">
          <h2>Navidrome Accounts</h2>
          <p style={{color: 'var(--text-secondary)', marginBottom: '1.5rem'}}>
            Add multiple accounts to fetch recently played tracks from different users.
          </p>
          
          <div style={{marginBottom: '2rem'}}>
            {accounts.length === 0 ? (
              <p style={{color: 'var(--text-secondary)', fontStyle: 'italic'}}>No accounts added yet.</p>
            ) : (
              <ul style={{listStyle: 'none', padding: 0}}>
                {accounts.map(acc => (
                  <li key={acc.id} style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', marginBottom: '0.5rem'}}>
                    <div>
                      <strong>{acc.username}</strong> @ {acc.url}
                    </div>
                    <button onClick={() => removeAccount(acc.id)} className="glass-button danger" style={{padding: '8px 12px'}}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={addAccount} style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '8px'}}>
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
              <label>Salt (Optional if using plaintext password)</label>
              <input type="text" value={newAccount.salt} onChange={e => setNewAccount({...newAccount, salt: e.target.value})} className="glass-input" />
            </div>
            <div style={{gridColumn: '1 / -1', marginTop: '1rem'}}>
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
