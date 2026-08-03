'use client';

import { useState, useEffect, useCallback } from 'react';
import VariantsModal from '@/components/VariantsModal';
import {
  Package,
  Plus,
  Edit2,
  Trash2,
  Loader2,
  X,
  AlertCircle,
  Database,
  RefreshCw,
} from '../../../components/icons';
import ConfirmModal from '../../../components/ConfirmModal';
import { productsApi } from '../../../lib/api';

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
  stockQuantity: number;
  attributes: Record<string, any>;
  embeddingHasEmbedding: boolean; // boolean if pgvector exists
  createdAt: string;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Per-combination stock (Phase 1) — opened per product.
  const [variantsFor, setVariantsFor] = useState<Product | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    sku: '',
    price: '',
    stockQuantity: '0',
    attributes: '', // JSON string for MVP
  });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await productsApi.getProducts({ limit: 100 }); // simplified for MVP
      setProducts(res.data.data.products || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const openModal = (product?: Product) => {
    setFormError('');
    if (product) {
      setEditingId(product.id);
      setFormData({
        name: product.name,
        description: product.description || '',
        sku: product.sku || '',
        price: Number(product.price).toString(),
        stockQuantity: product.stockQuantity.toString(),
        attributes: product.attributes && Object.keys(product.attributes).length > 0
          ? JSON.stringify(product.attributes, null, 2)
          : '',
      });
    } else {
      setEditingId(null);
      setFormData({
        name: '',
        description: '',
        sku: '',
        price: '',
        stockQuantity: '0',
        attributes: '',
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    setFormError('');
    setIsSaving(true);

    try {
      // Validate inputs
      if (!formData.name || !formData.price) {
        throw new Error('Name and price are required.');
      }

      let parsedAttributes = {};
      if (formData.attributes) {
        try {
          parsedAttributes = JSON.parse(formData.attributes);
        } catch (e) {
          throw new Error('Attributes must be valid JSON');
        }
      }

      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        sku: formData.sku || undefined,
        price: parseFloat(formData.price),
        stockQuantity: parseInt(formData.stockQuantity, 10),
        attributes: parsedAttributes,
      };

      if (editingId) {
        await productsApi.updateProduct(editingId, payload);
      } else {
        await productsApi.createProduct(payload);
      }

      closeModal();
      fetchProducts();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save product');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await productsApi.deleteProduct(deleteTarget.id);
      setDeleteTarget(null);
      fetchProducts();
    } catch (err) {
      console.error(err);
      setDeleteError('Could not delete this product. Please try again.');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="page animate-fade-in">
      {/* Header */}
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <div className="sub">Manage inventory and product vectors for AI semantic search</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchProducts}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => openModal()}>
            <Plus size={14} /> Add product
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="row" style={{ justifyContent: 'center', padding: '100px 0' }}>
          <Loader2 size={28} color="var(--brand)" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : products.length === 0 ? (
        <div className="card stack" style={{ alignItems: 'center', padding: '60px 24px', gap: 12 }}>
          <span className="row" style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--surface-3)', color: 'var(--ink-3)', justifyContent: 'center' }}>
            <Package size={24} />
          </span>
          <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>No products found</h3>
          <p className="t-muted" style={{ textAlign: 'center', marginBottom: 4 }}>Add your first product to allow the AI to match customer orders.</p>
          <button className="btn btn-primary btn-sm" onClick={() => openModal()}>
            <Plus size={14} /> Add product
          </button>
        </div>
      ) : (
        <div className="card table-scroll" style={{ overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price</th>
                <th>Stock</th>
                <th>AI vector</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map(product => (
                <tr key={product.id}>
                  <td data-label="Product">
                    <div>
                      <div style={{ fontWeight: 600 }}>{product.name}</div>
                      <div className="t-muted" style={{ fontSize: '0.75rem' }}>SKU: {product.sku || 'N/A'}</div>
                    </div>
                  </td>
                  <td data-label="Price" className="metric">${Number(product.price).toFixed(2)}</td>
                  <td data-label="Stock">
                    <span className={`badge ${product.stockQuantity > 10 ? 'badge-approved' : product.stockQuantity > 0 ? 'badge-pending' : 'badge-rejected'}`}>
                      {product.stockQuantity} in stock
                    </span>
                  </td>
                  <td data-label="AI vector">
                    <span className="badge badge-info">
                      <Database size={10} /> Synced
                    </span>
                  </td>
                  <td data-label="">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32 }} onClick={() => openModal(product)} aria-label="Edit product">
                        <Edit2 size={14} />
                      </button>
                      <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32 }} onClick={() => setVariantsFor(product)} aria-label={`Manage variants for ${product.name}`} title="Variants">
                        <Database size={14} />
                      </button>
                      <button className="btn btn-ghost btn-icon" style={{ width: 32, height: 32, color: 'var(--danger)' }} onClick={() => { setDeleteError(''); setDeleteTarget({ id: product.id, name: product.name }); }} aria-label="Delete product">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {variantsFor && (
        <VariantsModal
          productId={variantsFor.id}
          productName={variantsFor.name}
          productStock={variantsFor.stockQuantity}
          onClose={() => { setVariantsFor(null); void fetchProducts(); }}
        />
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="between" style={{ marginBottom: 22 }}>
              <h2 className="font-display" style={{ fontSize: '1.25rem' }}>{editingId ? 'Edit product' : 'New product'}</h2>
              <button className="btn btn-ghost btn-icon" style={{ width: 30, height: 30, border: 'none' }} onClick={closeModal} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {formError && (
              <div className="row" style={{ gap: 8, padding: 12, background: 'var(--danger-soft)', color: 'var(--danger)', borderRadius: 'var(--r-md)', fontSize: '0.8125rem', marginBottom: 16 }}>
                <AlertCircle size={14} /> {formError}
              </div>
            )}

            <div className="stack" style={{ gap: 16 }}>
              <label className="stack" style={{ gap: 6 }}>
                Product name *
                <input className="input" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. White School Shirt" />
              </label>
              <div className="form-2col">
                <label className="stack" style={{ gap: 6 }}>
                  Price *
                  <input className="input" type="number" step="0.01" value={formData.price} onChange={e => setFormData({ ...formData, price: e.target.value })} placeholder="0.00" />
                </label>
                <label className="stack" style={{ gap: 6 }}>
                  Stock quantity *
                  <input className="input" type="number" value={formData.stockQuantity} onChange={e => setFormData({ ...formData, stockQuantity: e.target.value })} />
                </label>
              </div>
              <label className="stack" style={{ gap: 6 }}>
                SKU (optional)
                <input className="input" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="e.g. WSS-01" />
              </label>
              <label className="stack" style={{ gap: 6 }}>
                Description (optional)
                <textarea className="input" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Product details..." />
              </label>
              <label className="stack" style={{ gap: 6 }}>
                Attributes — JSON (optional)
                <textarea className="input" style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8125rem' }} value={formData.attributes} onChange={e => setFormData({ ...formData, attributes: e.target.value })} placeholder='{"color": "white", "size": "M"}' />
              </label>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
              <button className="btn btn-ghost" onClick={closeModal} disabled={isSaving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Save product'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        title={deleteTarget ? `Delete “${deleteTarget.name}”?` : 'Delete product?'}
        description={deleteError || 'This product will be permanently removed from your catalog and can no longer be matched by the AI. This cannot be undone.'}
        confirmLabel="Delete product"
        cancelLabel="Cancel"
        tone="danger"
        loading={deleteLoading}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <style>{`
        .form-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 480px) { .form-2col { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
