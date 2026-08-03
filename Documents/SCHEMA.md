# CommercePilot — Database Schema

Multi-tenant SaaS. **Every business-owned table carries `tenantId`** — that is the
isolation boundary, and the reason almost every relationship below fans out from
`Tenant`.

Generated from `backend/prisma/schema.prisma`. For an interactive diagram, paste
[`schema.dbml`](schema.dbml) into [dbdiagram.io](https://dbdiagram.io).

```mermaid
erDiagram
    tenants {
        string id PK
        string name
        string slug UK
        TenantPlan plan
        bool isActive
        string whatsappPhoneNumberId
        string whatsappAccessToken
        string whatsappVerifyToken
        WhatsAppProvider whatsappProvider
        string woocommerceUrl
        string woocommerceKey
        string woocommerceSecret
        EcommerceProvider woocommerceProvider
        float aiConfidenceThreshold
        string _more_
    }
    users {
        string id PK
        string tenantId
        string name
        string email
        string passwordHash
        UserRole role
        bool isActive
        datetime lastLogin
        string refreshTokenHash
        datetime createdAt
        datetime updatedAt
        datetime deletedAt
    }
    customers {
        string id PK
        string tenantId
        string name
        string phone
        string email
        string address
        int totalOrders
        decimal lifetimeValue
        bool isBlocked
        string whatsappProfileName
        datetime createdAt
        datetime updatedAt
        datetime deletedAt
    }
    products {
        string id PK
        string tenantId
        string name
        string description
        string sku
        decimal price
        int stockQuantity
        bool isActive
        json attributes
        string woocommerceId
        string shopifyId
        vector embedding
        datetime createdAt
        datetime updatedAt
        string _more_
    }
    product_variants {
        string id PK
        string tenantId
        string productId
        json attributes
        string attributeKey
        string sku
        decimal price
        int stockQuantity
        bool isActive
        string woocommerceId
        datetime createdAt
        datetime updatedAt
        datetime deletedAt
    }
    orders {
        string id PK
        string tenantId
        string customerId
        string orderNumber
        OrderStatus status
        decimal totalAmount
        float aiConfidenceScore
        OrderSource source
        string deliveryAddress
        datetime requestedDate
        string notes
        string woocommerceOrderId
        string shopifyOrderId
        datetime syncedAt
        string _more_
    }
    order_items {
        string id PK
        string tenantId
        string orderId
        string productId
        string variantId
        int quantity
        decimal unitPrice
        decimal subtotal
        json selectedAttributes
        datetime createdAt
        datetime updatedAt
        datetime deletedAt
    }
    whatsapp_messages {
        string id PK
        string tenantId
        string customerId
        string phone
        string messageText
        MessageDirection direction
        MessageType messageType
        MessageStatus status
        string externalMessageId UK
        string mediaUrl
        string mediaType
        json referral
        bool aiProcessed
        datetime aiProcessedAt
        string _more_
    }
    conversations {
        string id PK
        string tenantId
        string customerId
        string phone
        ConversationStatus status
        ConversationStage currentStage
        json partialOrderData
        datetime startedAt
        datetime lastMessageAt
        datetime endedAt
        datetime createdAt
        datetime updatedAt
    }
    ai_processing_logs {
        string id PK
        string tenantId
        string messageId
        AIProcessingStage stage
        json inputData
        json outputData
        string modelUsed
        string promptVersion
        int processingTimeMs
        int tokenCount
        float intentConfidence
        float productMatchConfidence
        float completenessScore
        float overallConfidence
        string _more_
    }
    ai_draft_orders {
        string id PK
        string tenantId
        string customerId
        string messageId
        string customerMessage
        json structuredData
        float intentConfidence
        float productMatchConfidence
        float completenessScore
        float overallConfidence
        AIDraftStatus status
        json humanCorrections
        string correctedByUserId
        datetime correctedAt
        string _more_
    }
    ai_draft_order_items {
        string id PK
        string tenantId
        string draftOrderId
        string productId
        string variantId
        string productQuery
        string matchedProductName
        float matchConfidence
        int quantity
        decimal unitPrice
        json selectedAttributes
        datetime createdAt
        datetime updatedAt
    }
    inventory_transactions {
        string id PK
        string tenantId
        string productId
        InventoryTxType type
        int quantity
        string referenceOrderId
        string notes
        datetime createdAt
    }
    notifications {
        string id PK
        string tenantId
        string userId
        NotificationType type
        NotificationChannel channel
        string title
        string message
        NotificationStatus status
        json metadata
        datetime sentAt
        datetime failedAt
        string failReason
        int retryCount
        datetime createdAt
        string _more_
    }
    unfulfilled_demand {
        string id PK
        string tenantId
        string customerId
        string messageId
        string query
        string normalizedQuery
        UnfulfilledReason reason
        datetime createdAt
    }
    audit_logs {
        string id PK
        string tenantId
        string actorUserId
        string actorType
        string action
        string entityType
        string entityId
        json beforeState
        json afterState
        string ipAddress
        string userAgent
        string correlationId
        datetime timestamp
    }

    tenants ||--o{ users : "tenantId"
    tenants ||--o{ customers : "tenantId"
    tenants ||--o{ products : "tenantId"
    tenants ||--o{ product_variants : "tenantId"
    products ||--o{ product_variants : "productId"
    tenants ||--o{ orders : "tenantId"
    customers ||--o{ orders : "customerId"
    ai_draft_orders ||--o{ orders : "aiDraftOrderId"
    tenants ||--o{ order_items : "tenantId"
    orders ||--o{ order_items : "orderId"
    products ||--o{ order_items : "productId"
    tenants ||--o{ whatsapp_messages : "tenantId"
    customers ||--o{ whatsapp_messages : "customerId"
    conversations ||--o{ whatsapp_messages : "conversationId"
    tenants ||--o{ conversations : "tenantId"
    customers ||--o{ conversations : "customerId"
    tenants ||--o{ ai_processing_logs : "tenantId"
    whatsapp_messages ||--o{ ai_processing_logs : "messageId"
    ai_draft_orders ||--o{ ai_draft_orders : "duplicateOfId"
    tenants ||--o{ ai_draft_orders : "tenantId"
    customers ||--o{ ai_draft_orders : "customerId"
    tenants ||--o{ ai_draft_order_items : "tenantId"
    ai_draft_orders ||--o{ ai_draft_order_items : "draftOrderId"
    products ||--o{ ai_draft_order_items : "productId"
    tenants ||--o{ inventory_transactions : "tenantId"
    products ||--o{ inventory_transactions : "productId"
    tenants ||--o{ notifications : "tenantId"
    users ||--o{ notifications : "userId"
    tenants ||--o{ unfulfilled_demand : "tenantId"
    tenants ||--o{ audit_logs : "tenantId"
    users ||--o{ audit_logs : "actorUserId"
```

## Cardinality

All relationships are **one-to-many** from parent to child (`||--o{`), read as:
one parent row may have zero or more child rows, and each child belongs to
exactly one parent. The single self-relation is
`ai_draft_orders.duplicateOfId -> ai_draft_orders.id`, which links a draft
flagged as a possible duplicate back to the original.