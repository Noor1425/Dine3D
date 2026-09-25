'use client';
import { useState, useEffect } from 'react';
import saApi from '@/lib/saApi';
import { toast } from 'sonner';
import { useSuperAdminAccess } from '@/components/superadmin/SuperAdminAccessContext';

const STATUS_COLORS = {
  pending:     'bg-amber-500/10 text-amber-500 border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  completed:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  rejected:    'bg-red-500/10 text-red-500 border-red-500/20',
};

export default function ModelRequestsPage() {
  const { can } = useSuperAdminAccess();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [fulfillmentData, setFulfillmentData] = useState({ status: 'completed', reason: '' });
  const [modelFile, setModelFile] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await saApi.getModelRequests(statusFilter);
      setRequests(data || []);
    } catch (e) {
      toast.error(e.message || 'Model requests could not be loaded');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const handleUpdate = async (id, data) => {
    setActionLoading(id);
    try {
      if (modelFile) {
        const formData = new FormData();
        formData.append('model', modelFile);
        formData.append('status', data.status);
        formData.append('reason', data.reason);
        await saApi.updateModelRequest(id, formData);
      } else {
        await saApi.updateModelRequest(id, data);
      }
      setSelectedRequest(null);
      setModelFile(null);
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const downloadAllImages = async (req) => {
    if (!req.imageUrls || req.imageUrls.length === 0) {
      toast.error('No images to download');
      return;
    }

    // Create a zip-like download by fetching each image
    for (let i = 0; i < req.imageUrls.length; i++) {
      const url = req.imageUrls[i];
      const fileName = `${req.menuItem?.name || 'item'}_${i + 1}.jpg`;
      
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Image ${i + 1} could not be downloaded`);
        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
        
        // Delay between downloads
        if (i < req.imageUrls.length - 1) {
          await new Promise(r => setTimeout(r, 300));
        }
      } catch (err) {
        toast.error(err.message || `Image ${i + 1} could not be downloaded`);
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight italic">3D requests</h1>
          <p className="text-sa-500 text-sm mt-1 uppercase tracking-widest font-bold">Fulfillment Queue</p>
        </div>
        <div className="flex gap-2 bg-sa-900 border border-sa-800 p-1 rounded-xl">
          {[
            ['', 'All'],
            ['pending', 'Pending'],
            ['in_progress', 'Started'],
            ['completed', 'Done']
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                statusFilter === val ? 'bg-orange-500 text-white' : 'text-sa-500 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : requests.length === 0 ? (
        <div className="bg-sa-900/50 border border-sa-800 border-dashed rounded-3xl py-20 text-center">
          <div className="text-4xl mb-4 opacity-20">✦</div>
          <p className="text-sa-500 font-bold uppercase tracking-widest text-xs">No requests in queue</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map(req => (
            <div 
              key={req.id} 
              className="bg-sa-900 border border-sa-800 rounded-2xl overflow-hidden hover:border-sa-700 transition-all group"
            >
              <div className="p-6 flex flex-wrap items-center gap-6">
                {/* Thumb */}
                <div className="w-16 h-16 rounded-xl bg-sa-950 border border-sa-800 flex-shrink-0 flex items-center justify-center overflow-hidden">
                  {req.imageUrls?.[0] ? (
                    <img src={req.imageUrls[0]} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <span className="text-sa-700 text-xl font-black">?</span>
                  )}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${STATUS_COLORS[req.status]}`}>
                      {req.status}
                    </span>
                    <span className="text-sa-600 font-bold text-[10px] uppercase tracking-widest">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="text-white font-black text-lg tracking-tight leading-tight">
                    {req.menuItem?.name || 'Deleted Item'}
                  </h3>
                  <p className="text-sa-400 text-xs font-bold uppercase tracking-tight">
                    Store: <span className="text-orange-400/80">{req.restaurant?.name}</span>
                  </p>
                </div>

                {/* Imagery Preview */}
                <div className="flex -space-x-2">
                  {req.imageUrls?.map((url, i) => (
                    <div key={i} className="w-10 h-10 rounded-lg border-2 border-sa-900 bg-sa-800 overflow-hidden shadow-xl ring-1 ring-white/5">
                      <img src={url} className="w-full h-full object-cover" alt="" />
                    </div>
                  ))}
                </div>

                {/* Action */}
                <button
                  onClick={() => setSelectedRequest(req)}
                  className="bg-white text-sa-900 font-black px-6 py-3 rounded-xl text-sm hover:bg-brand-500 hover:text-white transition-all shadow-xl"
                >
                  Manage Request
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fulfillment Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => setSelectedRequest(null)} />
          <div className="relative bg-sa-900 border border-sa-800 rounded-[2rem] w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="p-8">
              <div className="flex items-start justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black text-white italic tracking-tight">{selectedRequest.menuItem?.name}</h2>
                  <p className="text-sa-500 text-xs font-bold uppercase tracking-widest mt-1">
                    Request from {selectedRequest.restaurant?.name}
                  </p>
                </div>
                <button onClick={() => setSelectedRequest(null)} className="text-sa-600 hover:text-white text-xl">✕</button>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                {/* Images */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-[10px] font-black text-sa-500 uppercase tracking-[0.2em]">Reference Photos</label>
                    <button
                      onClick={() => downloadAllImages(selectedRequest)}
                      className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-sa-800 text-orange-400 hover:bg-orange-500/20 transition-all"
                    >
                      ⬇️ Download All
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedRequest.imageUrls?.map((url, i) => (
                      <a key={i} href={url} target="_blank" className="aspect-square rounded-2xl overflow-hidden border border-sa-800 hover:border-orange-500/50 transition-all group relative">
                        <img src={url} className="w-full h-full object-cover" alt="" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                          <span className="text-[10px] font-bold text-white uppercase tracking-widest">Full View</span>
                        </div>
                      </a>
                    ))}
                  </div>
                  {selectedRequest.notes && (
                    <div className="bg-sa-950 p-4 rounded-2xl border border-sa-800">
                      <label className="block text-[10px] font-black text-sa-600 uppercase tracking-widest mb-2">Request Notes</label>
                      <p className="text-sa-300 text-sm italic">"{selectedRequest.notes}"</p>
                    </div>
                  )}
                </div>

                {/* Fulfillment Form */}
                {can('support.manage') ? <div className="space-y-6">
                  <label className="block text-[10px] font-black text-sa-500 uppercase tracking-[0.2em]">Fulfillment Details</label>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-sa-400 mb-2">3D Model File (.glb) *</label>
                      <label className="block">
                        <input 
                          type="file"
                          accept=".glb,.gltf"
                          onChange={e => setModelFile(e.target.files?.[0] || null)}
                          className="w-full bg-sa-950 border border-sa-800 rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500 outline-none transition-all cursor-pointer"
                        />
                      </label>
                      {modelFile && (
                        <div className="mt-2 text-sm text-emerald-400 flex items-center gap-2">
                          <span>✓</span>
                          <span className="truncate">{modelFile.name}</span>
                        </div>
                      )}
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-sa-400 mb-2">Status</label>
                      <select 
                        value={fulfillmentData.status}
                        onChange={e => setFulfillmentData({...fulfillmentData, status: e.target.value})}
                        className="w-full bg-sa-950 border border-sa-800 rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500 outline-none transition-all appearance-none"
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="completed">Completed & Upload</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </div>
                    <div><label className="block text-xs font-bold text-sa-400 mb-2">Audit reason</label><input required minLength={5} value={fulfillmentData.reason} onChange={e => setFulfillmentData({ ...fulfillmentData, reason: e.target.value })} className="w-full bg-sa-950 border border-sa-800 rounded-xl px-4 py-3 text-white text-sm focus:border-orange-500 outline-none" /></div>
                  </div>

                  <button
                    onClick={() => handleUpdate(selectedRequest.id, fulfillmentData)}
                    disabled={actionLoading === selectedRequest.id || !fulfillmentData.reason.trim() || (fulfillmentData.status === 'completed' && !modelFile && !selectedRequest.menuItem?.modelUrl)}
                    className="w-full bg-brand-500 text-sa-950 font-black py-4 rounded-2xl shadow-[0_10px_20px_rgba(249,115,22,0.2)] hover:shadow-[0_10px_30px_rgba(249,115,22,0.3)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading === selectedRequest.id ? 'Updating…' : fulfillmentData.status === 'completed' ? 'Upload & complete' : 'Update request'}
                  </button>

                  <p className="text-[10px] text-sa-600 text-center uppercase tracking-widest font-bold">
                    Upload will auto-embed the model in the restaurant's store
                  </p>
                </div> : <div className="rounded-2xl border border-sa-800 bg-sa-950 p-5 text-sm text-sa-500">Read-only access. The <code>support.manage</code> permission is required to change status or upload a model.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
