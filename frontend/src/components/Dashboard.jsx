import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { X, Download, RefreshCw, Check, AlertTriangle } from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

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
    return <div style={{textAlign: 'center', marginTop: '100px'}}>Loading recommendations...</div>;
  }

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{fontSize: '2rem', fontWeight: 'bold'}}>Recommended for You</h1>
        <button 
          onClick={triggerSync} 
          disabled={syncing}
          className="glass-button"
        >
          <RefreshCw size={18} className={syncing ? "spinning" : ""} />
          {syncing ? 'Generating...' : 'Refresh AI'}
        </button>
      </div>

      {recommendations.length === 0 ? (
        <div className="glass-panel" style={{padding: '3rem', textAlign: 'center'}}>
          <p style={{color: 'var(--text-secondary)', marginBottom: '1rem'}}>No recommendations available.</p>
          <button className="glass-button" onClick={triggerSync}>Generate New Recommendations</button>
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
                    <button className="glass-button" disabled style={{background: 'var(--success-color)', opacity: 0.9}}>
                      <Check size={16} /> Downloaded
                    </button>
                  )}
                  {track.status === 'failed' && (
                    <button className="glass-button danger" disabled style={{opacity: 0.9}}>
                      <AlertTriangle size={16} /> Failed
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <style>{`
        .spinning {
          animation: spin 2s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default Dashboard;
