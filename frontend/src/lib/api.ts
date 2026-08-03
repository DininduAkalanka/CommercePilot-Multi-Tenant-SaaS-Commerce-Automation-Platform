'use client';

import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 seconds — AI pipeline can take a few seconds
});

// ── Request Interceptor: Attach JWT token ─────────────────────────
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('commercepilot_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response Interceptor: Handle 401 → attempt token refresh ──────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((p) => {
    if (error) {
      p.reject(error);
    } else if (token) {
      p.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !originalRequest._retry
    ) {
      // Skip refresh for auth endpoints themselves
      if (
        originalRequest.url?.includes('/auth/login') ||
        originalRequest.url?.includes('/auth/register') ||
        originalRequest.url?.includes('/auth/refresh')
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue this request until refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({
            resolve: (token: string) => {
              originalRequest.headers.Authorization = `Bearer ${token}`;
              resolve(api(originalRequest));
            },
            reject: (err: unknown) => reject(err),
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('commercepilot_refresh_token');
      if (!refreshToken) {
        // No refresh token — redirect to login
        localStorage.removeItem('commercepilot_token');
        localStorage.removeItem('commercepilot_user');
        localStorage.removeItem('commercepilot_refresh_token');
        const path = window.location.pathname;
        if (!path.startsWith('/login') && !path.startsWith('/register')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      try {
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });
        const { accessToken, refreshToken: newRefreshToken } =
          response.data.data;

        localStorage.setItem('commercepilot_token', accessToken);
        localStorage.setItem('commercepilot_refresh_token', newRefreshToken);

        processQueue(null, accessToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        localStorage.removeItem('commercepilot_token');
        localStorage.removeItem('commercepilot_user');
        localStorage.removeItem('commercepilot_refresh_token');
        const path = window.location.pathname;
        if (!path.startsWith('/login') && !path.startsWith('/register')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  },
);

// ── Auth API ──────────────────────────────────────────────────────
export const authApi = {
  register: (data: {
    businessName: string;
    ownerName: string;
    email: string;
    password: string;
  }) => api.post('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),

  refresh: (refreshToken: string) =>
    api.post('/auth/refresh', { refreshToken }),

  logout: () => api.post('/auth/logout'),

  getMe: () => api.get('/auth/me'),
};

// ── Orders API ────────────────────────────────────────────────────
export const ordersApi = {
  getStats: () => api.get('/orders/stats'),

  getDrafts: () => api.get('/orders/drafts'),

  getDraftById: (id: string) => api.get(`/orders/drafts/${id}`),

  approveDraft: (id: string, notes?: string) =>
    api.patch(`/orders/drafts/${id}/approve`, { notes }),

  rejectDraft: (id: string, reason: string) =>
    api.patch(`/orders/drafts/${id}/reject`, { reason }),

  correctDraft: (id: string, correctedData: Record<string, unknown>) =>
    api.patch(`/orders/drafts/${id}/correct`, { correctedData }),

  getOrders: (params?: { status?: string; page?: number; limit?: number }) =>
    api.get('/orders', { params }),

  getRecentActivity: () => api.get('/orders/recent-activity'),

  /** Analytics data for charts — daily order volume, status breakdown, AI metrics */
  getAnalytics: () => api.get('/orders/analytics'),
};

// ── Products API ──────────────────────────────────────────────────
export const productsApi = {
  getProducts: (params?: { page?: number; limit?: number }) =>
    api.get('/products', { params }),

  getProduct: (id: string) => api.get(`/products/${id}`),

  createProduct: (data: {
    name: string;
    description?: string;
    sku?: string;
    price: number;
    stockQuantity: number;
    attributes?: Record<string, unknown>;
  }) => api.post('/products', data),

  updateProduct: (
    id: string,
    data: Partial<{
      name: string;
      description: string;
      sku: string;
      price: number;
      stockQuantity: number;
      attributes: Record<string, unknown>;
    }>,
  ) => api.patch(`/products/${id}`, data),

  deleteProduct: (id: string) => api.delete(`/products/${id}`),
};

/**
 * Per-combination stock (Phase 1).
 *
 * Nested under a product because a variant has no meaning without one — the
 * backend routes are /products/:productId/variants for the same reason.
 */
export const variantsApi = {
  getVariants: (productId: string) =>
    api.get(`/products/${productId}/variants`),

  createVariant: (
    productId: string,
    data: {
      attributes: Record<string, unknown>;
      sku?: string | null;
      price?: number | null;
      stockQuantity?: number;
      isActive?: boolean;
    },
  ) => api.post(`/products/${productId}/variants`, data),

  updateVariant: (
    productId: string,
    variantId: string,
    data: Partial<{
      attributes: Record<string, unknown>;
      sku: string | null;
      price: number | null;
      stockQuantity: number;
      isActive: boolean;
    }>,
  ) => api.patch(`/products/${productId}/variants/${variantId}`, data),

  deleteVariant: (productId: string, variantId: string) =>
    api.delete(`/products/${productId}/variants/${variantId}`),
};


// ── WhatsApp Simulator API ────────────────────────────────────────
export const simulatorApi = {
  sendMessage: (data: { phone: string; message: string }) =>
    api.post('/whatsapp/simulator/send', data),

  getMessages: () => api.get('/whatsapp/simulator/messages'),
};

// ── Customers API ─────────────────────────────────────────────────
export const customersApi = {
  getCustomers: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get('/customers', { params }),

  getCustomer: (id: string) => api.get(`/customers/${id}`),

  /** Get all orders placed by a specific customer */
  getCustomerOrders: (id: string) => api.get(`/customers/${id}/orders`),

  /** Get full WhatsApp conversation history for a customer */
  getCustomerMessages: (id: string, limit?: number) =>
    api.get(`/customers/${id}/messages`, { params: { limit } }),
};

// ── Integrations API ──────────────────────────────────────────────
export const integrationsApi = {
  syncWooCommerce: () => api.post('/integrations/woocommerce/sync'),
};

// ── Settings API ──────────────────────────────────────────────────
export const settingsApi = {
  /** GET /api/v1/settings — Retrieve current tenant settings */
  getSettings: () => api.get('/settings'),

  /** PATCH /api/v1/settings — Update tenant settings (OWNER only) */
  updateSettings: (data: Partial<{
    aiConfidenceThreshold: number;
    autoApproveEnabled: boolean;
    autoApproveThreshold: number;
    woocommerceUrl: string;
    woocommerceKey: string;
    woocommerceSecret: string;
    businessHours: Record<string, unknown>;
  }>) => api.patch('/settings', data),
};

// ── Notifications API ─────────────────────────────────────────────
export const notificationsApi = {
  /** GET /api/v1/notifications — Paginated notification list */
  getNotifications: (params?: { page?: number; limit?: number; status?: string }) =>
    api.get('/notifications', { params }),

  /** PATCH /api/v1/notifications/:id/read — Mark a notification as read */
  markAsRead: (id: string) => api.patch(`/notifications/${id}/read`),
};

// ── AI Engine API ─────────────────────────────────────────────────
export const aiEngineApi = {
  /** GET /api/v1/ai-engine/metrics — pipeline health, confidence, correction rate */
  getMetrics: (days = 7) => api.get('/ai-engine/metrics', { params: { days } }),

  /** GET /api/v1/ai-engine/unfulfilled-demand — what customers asked for and couldn't get */
  getUnfulfilledDemand: (days = 30, limit = 20) =>
    api.get('/ai-engine/unfulfilled-demand', { params: { days, limit } }),
};

export default api;
