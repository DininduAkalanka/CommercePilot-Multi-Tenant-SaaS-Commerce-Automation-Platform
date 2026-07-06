-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TenantPlan" AS ENUM ('STARTER', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_AI', 'WAITING_APPROVAL', 'APPROVED', 'REJECTED', 'SYNCED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('WHATSAPP', 'MANUAL', 'API');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'STICKER', 'LOCATION');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ConversationStage" AS ENUM ('ACTIVE', 'GATHERING_INFO', 'CONFIRMING', 'PENDING_ORDER', 'CLOSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AIProcessingStage" AS ENUM ('INTENT_DETECTION', 'PRODUCT_RETRIEVAL', 'ENTITY_EXTRACTION', 'CONFIDENCE_SCORING', 'DRAFT_ORDER_GENERATION', 'CONFLICT_RESOLUTION');

-- CreateEnum
CREATE TYPE "AIDraftStatus" AS ENUM ('PENDING', 'REVIEWED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'RETURN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ORDER_PENDING_APPROVAL', 'ORDER_APPROVED', 'ORDER_REJECTED', 'ORDER_SYNCED', 'LOW_STOCK_ALERT', 'AI_PROCESSING_FAILED', 'CUSTOMER_CONFIRMATION', 'SYSTEM_ALERT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WHATSAPP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppProvider" AS ENUM ('MOCK', 'META_CLOUD_API');

-- CreateEnum
CREATE TYPE "EcommerceProvider" AS ENUM ('MOCK', 'WOOCOMMERCE', 'SHOPIFY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" "TenantPlan" NOT NULL DEFAULT 'STARTER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "whatsappPhoneNumberId" TEXT,
    "whatsappAccessToken" TEXT,
    "whatsappVerifyToken" TEXT,
    "whatsappProvider" "WhatsAppProvider" NOT NULL DEFAULT 'MOCK',
    "woocommerceUrl" TEXT,
    "woocommerceKey" TEXT,
    "woocommerceSecret" TEXT,
    "woocommerceProvider" "EcommerceProvider" NOT NULL DEFAULT 'MOCK',
    "aiConfidenceThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "autoApproveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoApproveThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "businessHours" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "refreshTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "lifetimeValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "whatsappProfileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sku" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "attributes" JSONB,
    "woocommerceId" TEXT,
    "shopifyId" TEXT,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_AI',
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "aiConfidenceScore" DOUBLE PRECISION,
    "source" "OrderSource" NOT NULL DEFAULT 'WHATSAPP',
    "deliveryAddress" TEXT,
    "requestedDate" TIMESTAMP(3),
    "notes" TEXT,
    "woocommerceOrderId" TEXT,
    "shopifyOrderId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "aiDraftOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "selectedAttributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID,
    "phone" TEXT NOT NULL,
    "messageText" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "messageType" "MessageType" NOT NULL DEFAULT 'TEXT',
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "externalMessageId" TEXT,
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "aiProcessed" BOOLEAN NOT NULL DEFAULT false,
    "aiProcessedAt" TIMESTAMP(3),
    "aiProcessingLogId" UUID,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" UUID,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStage" "ConversationStage" NOT NULL DEFAULT 'ACTIVE',
    "partialOrderData" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_processing_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "messageId" UUID,
    "stage" "AIProcessingStage" NOT NULL,
    "inputData" JSONB NOT NULL,
    "outputData" JSONB NOT NULL,
    "modelUsed" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT '1.0.0',
    "processingTimeMs" INTEGER NOT NULL,
    "tokenCount" INTEGER,
    "intentConfidence" DOUBLE PRECISION,
    "productMatchConfidence" DOUBLE PRECISION,
    "completenessScore" DOUBLE PRECISION,
    "overallConfidence" DOUBLE PRECISION,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_processing_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_draft_orders" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "messageId" UUID,
    "customerMessage" TEXT NOT NULL,
    "structuredData" JSONB NOT NULL,
    "intentConfidence" DOUBLE PRECISION NOT NULL,
    "productMatchConfidence" DOUBLE PRECISION NOT NULL,
    "completenessScore" DOUBLE PRECISION NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "status" "AIDraftStatus" NOT NULL DEFAULT 'PENDING',
    "humanCorrections" JSONB,
    "correctedByUserId" UUID,
    "correctedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ai_draft_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_draft_order_items" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "draftOrderId" UUID NOT NULL,
    "productId" UUID,
    "productQuery" TEXT NOT NULL,
    "matchedProductName" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2),
    "selectedAttributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_draft_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "InventoryTxType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "referenceOrderId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "actorUserId" UUID,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_phone_key" ON "customers"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_tenantId_isActive_idx" ON "products"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_sku_key" ON "products"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "orders_aiDraftOrderId_key" ON "orders"("aiDraftOrderId");

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE INDEX "orders_tenantId_status_idx" ON "orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "orders_tenantId_createdAt_idx" ON "orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "order_items_tenantId_idx" ON "order_items"("tenantId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_externalMessageId_key" ON "whatsapp_messages"("externalMessageId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenantId_idx" ON "whatsapp_messages"("tenantId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_phone_idx" ON "whatsapp_messages"("phone");

-- CreateIndex
CREATE INDEX "whatsapp_messages_tenantId_aiProcessed_idx" ON "whatsapp_messages"("tenantId", "aiProcessed");

-- CreateIndex
CREATE INDEX "conversations_tenantId_idx" ON "conversations"("tenantId");

-- CreateIndex
CREATE INDEX "conversations_phone_idx" ON "conversations"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenantId_phone_status_key" ON "conversations"("tenantId", "phone", "status");

-- CreateIndex
CREATE INDEX "ai_processing_logs_tenantId_idx" ON "ai_processing_logs"("tenantId");

-- CreateIndex
CREATE INDEX "ai_processing_logs_messageId_idx" ON "ai_processing_logs"("messageId");

-- CreateIndex
CREATE INDEX "ai_processing_logs_stage_idx" ON "ai_processing_logs"("stage");

-- CreateIndex
CREATE INDEX "ai_draft_orders_tenantId_idx" ON "ai_draft_orders"("tenantId");

-- CreateIndex
CREATE INDEX "ai_draft_orders_tenantId_status_idx" ON "ai_draft_orders"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_draft_order_items_tenantId_idx" ON "ai_draft_order_items"("tenantId");

-- CreateIndex
CREATE INDEX "ai_draft_order_items_draftOrderId_idx" ON "ai_draft_order_items"("draftOrderId");

-- CreateIndex
CREATE INDEX "inventory_transactions_tenantId_idx" ON "inventory_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_transactions_productId_idx" ON "inventory_transactions"("productId");

-- CreateIndex
CREATE INDEX "inventory_transactions_createdAt_idx" ON "inventory_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_status_idx" ON "notifications"("tenantId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entityType_entityId_idx" ON "audit_logs"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_timestamp_idx" ON "audit_logs"("tenantId", "timestamp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_aiDraftOrderId_fkey" FOREIGN KEY ("aiDraftOrderId") REFERENCES "ai_draft_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_processing_logs" ADD CONSTRAINT "ai_processing_logs_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_draft_orders" ADD CONSTRAINT "ai_draft_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_draft_orders" ADD CONSTRAINT "ai_draft_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_draft_order_items" ADD CONSTRAINT "ai_draft_order_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_draft_order_items" ADD CONSTRAINT "ai_draft_order_items_draftOrderId_fkey" FOREIGN KEY ("draftOrderId") REFERENCES "ai_draft_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_draft_order_items" ADD CONSTRAINT "ai_draft_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

