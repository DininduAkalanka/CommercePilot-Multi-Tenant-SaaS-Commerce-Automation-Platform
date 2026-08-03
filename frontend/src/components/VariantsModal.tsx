'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2, AlertCircle, Package } from '@/components/icons';
import { variantsApi } from '@/lib/api';

interface Variant {
  id: string;
  attributes: Record<string, unknown>;
  attributeKey: string;
  sku: string | null;
  price: string | number | null;
  stockQuantity: number;
  isActive: boolean;
}

interface Props {
  productId: string;
  productName: string;
  productStock: number;
  onClose: () => void;
}

/** One option row in the add form, e.g. Size / L. */
interface OptionRow {
  key: string;
  value: string;
}

/**
 * Per-combination stock for one product.
 *
 * Phase 1 built the table, the backfill and the read switch, but left no way
 * for a shop owner to say "blue in L has 3" — only SQL or a WooCommerce sync
 * could create a real variant. This is that missing surface.
 *
 * Options are entered as name/value rows rather than raw JSON. The product
 * form uses a JSON textarea for its attributes, but that is an occasional
 * field; this is the primary interaction for anyone selling clothing, and
 * asking a shop owner to hand-write JSON to record stock would make the
 * feature unusable in practice.
 */
export default function VariantsModal({
  productId,
  productName,
  productStock,
  onClose,
}: Props) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [options, setOptions] = useState<OptionRow[]>([{ key: '', value: '' }]);
  const [stock, setStock] = useState('0');
  const [price, setPrice] = useState('');
  const [sku, setSku] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const res = await variantsApi.getVariants(productId);
      setVariants(res.data?.data ?? []);
    } catch {
      setError('Could not load variants. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setOptions([{ key: '', value: '' }]);
    setStock('0');
    setPrice('');
    setSku('');
  };

  const handleAdd = async () => {
    const attributes: Record<string, string> = {};

    for (const { key, value } of options) {
      if (key.trim() && value.trim()) attributes[key.trim()] = value.trim();
    }

    if (Object.keys(attributes).length === 0) {
      setError('Add at least one option, for example Size / L.');
      return;
    }

    const quantity = Number(stock);

    if (!Number.isInteger(quantity) || quantity < 0) {
      setError('Stock must be a whole number, zero or more.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await variantsApi.createVariant(productId, {
        attributes,
        stockQuantity: quantity,
        // Empty means "inherit the product price" rather than "free".
        price: price.trim() === '' ? null : Number(price),
        sku: sku.trim() === '' ? null : sku.trim(),
      });

      resetForm();
      await load();
    } catch (err: unknown) {
      // The backend rejects a duplicate combination by design — surfacing its
      // message is more useful than a generic failure, because it names the
      // combination that already exists.
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'Could not add this variant. Please try again.';
      setError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStockChange = async (variant: Variant, next: string) => {
    const quantity = Number(next);

    if (!Number.isInteger(quantity) || quantity < 0) return;

    // Optimistic: stock edits are the most frequent action here, and waiting
    // on a round trip for each keystroke-completed field makes it feel broken.
    setVariants((prev) =>
      prev.map((v) =>
        v.id === variant.id ? { ...v, stockQuantity: quantity } : v,
      ),
    );

    try {
      await variantsApi.updateVariant(productId, variant.id, {
        stockQuantity: quantity,
      });
    } catch {
      setError('Could not save that stock change.');
      await load();
    }
  };

  const handleDelete = async (variant: Variant) => {
    try {
      await variantsApi.deleteVariant(productId, variant.id);
      await load();
    } catch {
      setError('Could not remove this variant.');
    }
  };

  const describe = (variant: Variant): string => {
    const entries = Object.entries(variant.attributes ?? {});

    // The backfill gives every product a single option-less "default" variant
    // carrying its total stock. Showing "default" to a shop owner means
    // nothing, so name it for what it is.
    if (entries.length === 0) return 'All (no options)';

    return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
  };

  const mirrored = variants.reduce((sum, v) => sum + v.stockQuantity, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
      >
        <div className="between" style={{ marginBottom: 6 }}>
          <h2 className="font-display" style={{ fontSize: '1.25rem' }}>
            Variants — {productName}
          </h2>
          <button
            className="btn btn-ghost btn-icon"
            style={{ width: 30, height: 30, border: 'none' }}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p
          className="t-muted"
          style={{ fontSize: '0.8125rem', marginBottom: 18 }}
        >
          Stock per combination, so the assistant can tell a customer whether
          their exact size and colour is available.
        </p>

        {error && (
          <div
            className="row"
            style={{
              gap: 8,
              padding: 12,
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              borderRadius: 'var(--r-md)',
              fontSize: '0.8125rem',
              marginBottom: 16,
            }}
          >
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {isLoading ? (
          <p className="t-muted" style={{ fontSize: '0.875rem' }}>
            Loading variants…
          </p>
        ) : (
          <>
            {variants.length === 0 ? (
              <div
                className="stack"
                style={{
                  gap: 8,
                  alignItems: 'center',
                  padding: '24px 0',
                  textAlign: 'center',
                }}
              >
                <Package size={22} className="t-muted" />
                <p className="t-muted" style={{ fontSize: '0.875rem' }}>
                  No variants yet. Add one below to track stock per size or
                  colour.
                </p>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8, marginBottom: 18 }}>
                {variants.map((variant) => (
                  <div
                    key={variant.id}
                    className="between"
                    style={{
                      gap: 12,
                      padding: '10px 12px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-md)',
                    }}
                  >
                    <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: '0.875rem' }}>
                        {describe(variant)}
                      </span>
                      {variant.sku && (
                        <span
                          className="t-muted"
                          style={{ fontSize: '0.75rem' }}
                        >
                          {variant.sku}
                        </span>
                      )}
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <label
                        className="row"
                        style={{ gap: 6, fontSize: '0.8125rem' }}
                      >
                        <span className="t-muted">Stock</span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          style={{ width: 78 }}
                          value={variant.stockQuantity}
                          onChange={(e) =>
                            void handleStockChange(variant, e.target.value)
                          }
                          aria-label={`Stock for ${describe(variant)}`}
                        />
                      </label>
                      <button
                        className="btn btn-ghost btn-icon"
                        style={{
                          width: 32,
                          height: 32,
                          color: 'var(--danger)',
                        }}
                        onClick={() => void handleDelete(variant)}
                        aria-label={`Remove ${describe(variant)}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Surfaced because the two are kept in step but not enforced
                equal: a mismatch is the first sign the mirror has drifted. */}
            {variants.length > 0 && mirrored !== productStock && (
              <p
                className="t-muted"
                style={{ fontSize: '0.75rem', marginBottom: 14 }}
              >
                Variants total {mirrored}; the product total is {productStock}.
              </p>
            )}

            <div
              className="stack"
              style={{
                gap: 12,
                paddingTop: 16,
                borderTop: '1px solid var(--border)',
              }}
            >
              <strong style={{ fontSize: '0.875rem' }}>Add a variant</strong>

              {options.map((option, index) => (
                <div className="form-2col" key={index}>
                  <input
                    className="input"
                    placeholder="Option (e.g. Size)"
                    value={option.key}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) =>
                          i === index ? { ...o, key: e.target.value } : o,
                        ),
                      )
                    }
                  />
                  <input
                    className="input"
                    placeholder="Value (e.g. L)"
                    value={option.value}
                    onChange={(e) =>
                      setOptions((prev) =>
                        prev.map((o, i) =>
                          i === index ? { ...o, value: e.target.value } : o,
                        ),
                      )
                    }
                  />
                </div>
              ))}

              <button
                className="btn btn-ghost"
                style={{ alignSelf: 'flex-start', fontSize: '0.8125rem' }}
                onClick={() =>
                  setOptions((prev) => [...prev, { key: '', value: '' }])
                }
              >
                <Plus size={14} /> Another option
              </button>

              <div className="form-2col">
                <label className="stack" style={{ gap: 6 }}>
                  Stock *
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={stock}
                    onChange={(e) => setStock(e.target.value)}
                  />
                </label>
                <label className="stack" style={{ gap: 6 }}>
                  Price (optional)
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min={0}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Same as product"
                  />
                </label>
              </div>

              <label className="stack" style={{ gap: 6 }}>
                SKU (optional)
                <input
                  className="input"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g. SHIRT-BLUE-L"
                />
              </label>

              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-end' }}
                onClick={() => void handleAdd()}
                disabled={isSaving}
              >
                {isSaving ? 'Adding…' : 'Add variant'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
