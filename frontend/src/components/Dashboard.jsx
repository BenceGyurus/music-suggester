import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, Download, RefreshCw, Check, AlertTriangle } from 'lucide-react';

const API_BASE = '/api';

function Dashboard() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchRecommendations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/recommendations`);
      setRecommendations(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
    // Poll every 10 seconds for updates
    const interval = setInterval(fetchRecommendations, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDislike = async (track) => {
    try {
      // Optimistic UI update
      setRecommendations(recommendations.filter(r => r.id !== track.id));
      await axios.post(`${API_BASE}/dislike`, {
        id: track.id,
        type: 'track',
        name: track.title,
        artist: track.artist
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownload = async (trackId) => {
    try {
      setRecommendations(recommendations.map(r => r.id === trackId ? { ...r, status: 'queued' } : r));
      await axios.post(`${API_BASE}/download/${trackId}`);
    } catch (err) {
      console.error(err);
    }
  };

  const triggerSync = async () => {
    setSyncing(true);
    try {
      await axios.post(`${API_BASE}/recommendations/trigger`);
      // Wait a bit, then fetch
      setTimeout(() => {
        fetchRecommendations();
        setSyncing(false);
      }, 5000);
    } catch (err) {
      console.error(err);
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div style={{textAlign: 'center', marginTop: '100px', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
        <RefreshCw size={48} className="spinning" style={{ color: 'var(--accent-color)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text-secondary)' }}>Loading recommendations...</h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
        <div>
          <h1 style={{fontSize: '2.2rem', fontWeight: '800', marginBottom: '0.5rem', letterSpacing: '-0.5px'}}>Recommended for You</h1>
          <p style={{color: 'var(--text-secondary)'}}>AI-curated tracks based on your listening history.</p>
        </div>
        <button 
          onClick={triggerSync} 
          disabled={syncing}
          className={`glass-button primary ${syncing ? 'btn-pulse' : ''}`}
        >
          <RefreshCw size={18} className={syncing ? "spinning" : ""} />
          {syncing ? 'Generating...' : 'Refresh AI'}
        </button>
      </div>

      {recommendations.length === 0 ? (
        <div className="glass-panel" style={{padding: '5rem 3rem', textAlign: 'center'}}>
          <div style={{ background: 'var(--glass-highlight)', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
            <AlertTriangle size={32} style={{ color: 'var(--text-secondary)' }} />
          </div>
          <h2 style={{marginBottom: '1rem', fontWeight: '600'}}>No recommendations available yet.</h2>
          <p style={{color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto 2rem auto', lineHeight: '1.6'}}>
            It seems the AI hasn't found new tracks or is currently processing. Click the button below to force a sync.
          </p>
          <button className="glass-button primary" onClick={triggerSync}>Generate New Recommendations</button>
        </div>
      ) : (
        <div className="recommendations-grid">
          {recommendations.map((track) => (
            <div key={track.id} className="glass-panel track-card">
              <div className="track-image-container">
                {track.image_url ? (
                  <img src={track.image_url} alt={track.title} className="track-image" />
                ) : (
                  <div className="track-image-placeholder">No Cover Art</div>
                )}
              </div>
              <div className="track-info">
                <div>
                  <h3 className="track-title" title={track.title}>{track.title}</h3>
                  <p className="track-artist">{track.artist}</p>
                </div>
                
                <div className="track-actions">
                  {track.status === 'recommended' && (
                    <>
                      <button className="glass-button" onClick={() => handleDownload(track.id)}>
                        <Download size={16} /> Download
                      </button>
                      <button className="glass-button danger" onClick={() => handleDislike(track)}>
                        <X size={16} /> Dislike
                      </button>
                    </>
                  )}
                  {track.status === 'queued' && (
                    <button className="glass-button" disabled style={{opacity: 0.7}}>
                      <RefreshCw size={16} className="spinning" /> Queued
                    </button>
                  )}
                  {track.status === 'downloaded' && (
                    <>
                      <button className="glass-button" disabled style={{background: 'rgba(16, 185, 129, 0.2)', color: 'var(--success-color)', border: '1px solid rgba(16, 185, 129, 0.4)'}}>
                        <Check size={16} /> Downloaded
                      </button>
                      <button className="glass-button danger" onClick={() => handleDislike(track)}>
                        <X size={16} /> Dislike
                      </button>
                    </>
                  )}
                  {track.status === 'failed' && (
                    <>
                      <button className="glass-button danger" disabled style={{opacity: 0.9}}>
                        <AlertTriangle size={16} /> Failed
                      </button>
                      <button className="glass-button danger" onClick={() => handleDislike(track)}>
                        <X size={16} /> Dislike
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Dashboard;
