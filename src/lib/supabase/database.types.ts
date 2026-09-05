export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      advanced_checkout_requests: {
        Row: {
          actor_employee_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_payload: Json
          sale_id: string | null
          state: string
        }
        Insert: {
          actor_employee_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          request_payload: Json
          sale_id?: string | null
          state?: string
        }
        Update: {
          actor_employee_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_payload?: Json
          sale_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "advanced_checkout_requests_actor_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "advanced_checkout_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advanced_checkout_requests_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          approved_by_employee_id: string | null
          consumed_at: string | null
          created_at: string
          decided_at: string | null
          execution_idempotency_key: string | null
          expires_at: string
          id: string
          operation_code: string
          organization_id: string
          reason: string
          register_id: string | null
          request_payload: Json
          requested_amount_minor: number | null
          requested_at: string
          requested_by_employee_id: string
          status: string
          store_id: string | null
          updated_at: string
        }
        Insert: {
          approved_by_employee_id?: string | null
          consumed_at?: string | null
          created_at?: string
          decided_at?: string | null
          execution_idempotency_key?: string | null
          expires_at?: string
          id?: string
          operation_code: string
          organization_id: string
          reason: string
          register_id?: string | null
          request_payload: Json
          requested_amount_minor?: number | null
          requested_at?: string
          requested_by_employee_id: string
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Update: {
          approved_by_employee_id?: string | null
          consumed_at?: string | null
          created_at?: string
          decided_at?: string | null
          execution_idempotency_key?: string | null
          expires_at?: string
          id?: string
          operation_code?: string
          organization_id?: string
          reason?: string
          register_id?: string | null
          request_payload?: Json
          requested_amount_minor?: number | null
          requested_at?: string
          requested_by_employee_id?: string
          status?: string
          store_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_approved_employee_organization_fkey"
            columns: ["approved_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "approval_requests_requested_employee_organization_fkey"
            columns: ["requested_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "approval_requests_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          amount_threshold_minor: number | null
          created_at: string
          decision: string
          id: string
          is_enabled: boolean
          operation_code: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          amount_threshold_minor?: number | null
          created_at?: string
          decision?: string
          id?: string
          is_enabled?: boolean
          operation_code: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          amount_threshold_minor?: number | null
          created_at?: string
          decision?: string
          id?: string
          is_enabled?: boolean
          operation_code?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          actor_employee_id: string | null
          amount_minor: number | null
          approval_request_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          operation_code: string | null
          organization_id: string
          reason: string | null
          register_id: string | null
          store_id: string | null
          subject_employee_id: string | null
        }
        Insert: {
          actor_employee_id?: string | null
          amount_minor?: number | null
          approval_request_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          operation_code?: string | null
          organization_id: string
          reason?: string | null
          register_id?: string | null
          store_id?: string | null
          subject_employee_id?: string | null
        }
        Update: {
          actor_employee_id?: string | null
          amount_minor?: number | null
          approval_request_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          operation_code?: string | null
          organization_id?: string
          reason?: string | null
          register_id?: string | null
          store_id?: string | null
          subject_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_employee_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "audit_logs_approval_request_organization_fkey"
            columns: ["approval_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "audit_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "audit_logs_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "audit_logs_subject_employee_organization_fkey"
            columns: ["subject_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      cash_movements: {
        Row: {
          amount_minor: number
          created_at: string
          employee_id: string
          id: string
          idempotency_key: string
          movement_type: string
          organization_id: string
          reason: string
          register_id: string
          shift_id: string
          store_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          employee_id: string
          id?: string
          idempotency_key: string
          movement_type: string
          organization_id: string
          reason: string
          register_id: string
          shift_id: string
          store_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          employee_id?: string
          id?: string
          idempotency_key?: string
          movement_type?: string
          organization_id?: string
          reason?: string
          register_id?: string
          shift_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_employee_organization_fkey"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_shift_organization_fkey"
            columns: ["shift_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "cash_movements_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_requests: {
        Row: {
          actor_employee_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          request_payload: Json
          sale_id: string | null
          state: string
        }
        Insert: {
          actor_employee_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          request_payload: Json
          sale_id?: string | null
          state?: string
        }
        Update: {
          actor_employee_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          request_payload?: Json
          sale_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_requests_actor_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "checkout_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_requests_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      customer_display_sessions: {
        Row: {
          access_token_hash: string
          created_at: string
          created_by_employee_id: string
          current_state: Json
          id: string
          is_active: boolean
          last_published_at: string | null
          organization_id: string
          realtime_topic: string
          register_id: string
          revoked_at: string | null
          store_id: string
          updated_at: string
        }
        Insert: {
          access_token_hash: string
          created_at?: string
          created_by_employee_id: string
          current_state?: Json
          id?: string
          is_active?: boolean
          last_published_at?: string | null
          organization_id: string
          realtime_topic: string
          register_id: string
          revoked_at?: string | null
          store_id: string
          updated_at?: string
        }
        Update: {
          access_token_hash?: string
          created_at?: string
          created_by_employee_id?: string
          current_state?: Json
          id?: string
          is_active?: boolean
          last_published_at?: string | null
          organization_id?: string
          realtime_topic?: string
          register_id?: string
          revoked_at?: string | null
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_display_sessions_created_by_employee_id_fkey"
            columns: ["created_by_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_display_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_display_sessions_register_id_fkey"
            columns: ["register_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_display_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_segment_memberships: {
        Row: {
          created_at: string
          customer_id: string
          organization_id: string
          segment_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          organization_id: string
          segment_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          organization_id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segment_memberships_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "customer_segment_memberships_segment_organization_fkey"
            columns: ["segment_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          birthday: string | null
          created_at: string
          customer_number: number
          email: string | null
          full_name: string
          id: string
          loyalty_card_code: string
          notes: string | null
          organization_id: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          birthday?: string | null
          created_at?: string
          customer_number?: number
          email?: string | null
          full_name: string
          id?: string
          loyalty_card_code?: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          birthday?: string | null
          created_at?: string
          customer_number?: number
          email?: string | null
          full_name?: string
          id?: string
          loyalty_card_code?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dining_options: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dining_options_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      discounts: {
        Row: {
          amount_minor: number | null
          created_at: string
          discount_type: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          percentage_bps: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount_minor?: number | null
          created_at?: string
          discount_type: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          percentage_bps?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount_minor?: number | null
          created_at?: string
          discount_type?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          percentage_bps?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          employee_number: string
          expires_at: string
          id: string
          invited_by: string
          job_title: string | null
          organization_id: string
          organization_name_snapshot: string
          revoked_at: string | null
          role_id: string
          role_name_snapshot: string
          store_id: string
          store_name_snapshot: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          employee_number: string
          expires_at?: string
          id?: string
          invited_by: string
          job_title?: string | null
          organization_id: string
          organization_name_snapshot: string
          revoked_at?: string | null
          role_id: string
          role_name_snapshot: string
          store_id: string
          store_name_snapshot: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          employee_number?: string
          expires_at?: string
          id?: string
          invited_by?: string
          job_title?: string | null
          organization_id?: string
          organization_name_snapshot?: string
          revoked_at?: string | null
          role_id?: string
          role_name_snapshot?: string
          store_id?: string
          store_name_snapshot?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_invitations_inviter_organization_fkey"
            columns: ["invited_by", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_invitations_role_organization_fkey"
            columns: ["role_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_invitations_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      employee_roles: {
        Row: {
          created_at: string
          employee_id: string
          organization_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          organization_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          organization_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_roles_employee_organization_fkey"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_roles_role_organization_fkey"
            columns: ["role_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      employee_stores: {
        Row: {
          created_at: string
          employee_id: string
          organization_id: string
          store_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          organization_id: string
          store_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          organization_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_stores_employee_organization_fkey"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "employee_stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_stores_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      employees: {
        Row: {
          archived_at: string | null
          created_at: string
          employee_number: string
          id: string
          job_title: string | null
          organization_id: string
          profile_id: string
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          employee_number: string
          id?: string
          job_title?: string | null
          organization_id: string
          profile_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          employee_number?: string
          id?: string
          job_title?: string | null
          organization_id?: string
          profile_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_lines: {
        Row: {
          goods_receipt_id: string
          id: string
          organization_id: string
          purchase_order_line_id: string
          quantity_received: number
        }
        Insert: {
          goods_receipt_id: string
          id?: string
          organization_id: string
          purchase_order_line_id: string
          quantity_received: number
        }
        Update: {
          goods_receipt_id?: string
          id?: string
          organization_id?: string
          purchase_order_line_id?: string
          quantity_received?: number
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_order_line_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_receipt_organization_fkey"
            columns: ["goods_receipt_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          id: string
          note: string | null
          organization_id: string
          purchase_order_id: string
          received_at: string
          received_by_employee_id: string
          store_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          organization_id: string
          purchase_order_id: string
          received_at?: string
          received_by_employee_id: string
          store_id: string
        }
        Update: {
          id?: string
          note?: string | null
          organization_id?: string
          purchase_order_id?: string
          received_at?: string
          received_by_employee_id?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_employee_organization_fkey"
            columns: ["received_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "goods_receipts_order_organization_fkey"
            columns: ["purchase_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "goods_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      inventory_adjustment_reasons: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          movement_type: string
          name: string
          organization_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          movement_type?: string
          name: string
          organization_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          movement_type?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustment_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          adjustment_number: number
          created_at: string
          created_by_employee_id: string
          id: string
          note: string | null
          organization_id: string
          product_id: string
          quantity_delta: number
          reason_code: string
          store_id: string
          variant_id: string | null
        }
        Insert: {
          adjustment_number?: number
          created_at?: string
          created_by_employee_id: string
          id?: string
          note?: string | null
          organization_id: string
          product_id: string
          quantity_delta: number
          reason_code: string
          store_id: string
          variant_id?: string | null
        }
        Update: {
          adjustment_number?: number
          created_at?: string
          created_by_employee_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          product_id?: string
          quantity_delta?: number
          reason_code?: string
          store_id?: string
          variant_id?: string | null
        }
        Relationships: []
      }
      inventory_count_lines: {
        Row: {
          barcode_snapshot: string | null
          category_name_snapshot: string
          counted_quantity: number | null
          expected_quantity: number
          id: string
          inventory_count_id: string
          line_sort_order: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          sku_snapshot: string | null
          unit_snapshot: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          category_name_snapshot: string
          counted_quantity?: number | null
          expected_quantity: number
          id?: string
          inventory_count_id: string
          line_sort_order?: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          sku_snapshot?: string | null
          unit_snapshot: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          category_name_snapshot?: string
          counted_quantity?: number | null
          expected_quantity?: number
          id?: string
          inventory_count_id?: string
          line_sort_order?: number
          organization_id?: string
          product_id?: string
          product_name_snapshot?: string
          sku_snapshot?: string | null
          unit_snapshot?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_lines_count_organization_fkey"
            columns: ["inventory_count_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "inventory_counts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_count_lines_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_counts: {
        Row: {
          count_mode: string
          count_number: number
          completed_at: string | null
          completed_by_employee_id: string | null
          id: string
          include_zero_stock: boolean
          note: string | null
          organization_id: string
          scope_reference_id: string | null
          scope_selection: Json
          scope_type: string
          sort_mode: string
          started_at: string
          started_by_employee_id: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          count_mode?: string
          count_number?: number
          completed_at?: string | null
          completed_by_employee_id?: string | null
          id?: string
          include_zero_stock?: boolean
          note?: string | null
          organization_id: string
          scope_reference_id?: string | null
          scope_selection?: Json
          scope_type?: string
          sort_mode?: string
          started_at?: string
          started_by_employee_id: string
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          count_mode?: string
          count_number?: number
          completed_at?: string | null
          completed_by_employee_id?: string | null
          id?: string
          include_zero_stock?: boolean
          note?: string | null
          organization_id?: string
          scope_reference_id?: string | null
          scope_selection?: Json
          scope_type?: string
          sort_mode?: string
          started_at?: string
          started_by_employee_id?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_counts_completer_organization_fkey"
            columns: ["completed_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_counts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_counts_starter_organization_fkey"
            columns: ["started_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_counts_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      inventory_levels: {
        Row: {
          average_cost_minor: number
          id: string
          organization_id: string
          product_id: string
          quantity: number
          store_id: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          average_cost_minor?: number
          id?: string
          organization_id: string
          product_id: string
          quantity?: number
          store_id: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          average_cost_minor?: number
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          store_id?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_levels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_levels_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_levels_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_levels_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          actor_employee_id: string
          created_at: string
          id: string
          movement_type: string
          organization_id: string
          product_id: string
          quantity_after: number
          quantity_before: number
          quantity_delta: number
          reason: string
          reason_code: string | null
          source_id: string | null
          source_type: string | null
          store_id: string
          unit_cost_minor: number
          value_delta_minor: number
          variant_id: string | null
        }
        Insert: {
          actor_employee_id: string
          created_at?: string
          id?: string
          movement_type: string
          organization_id: string
          product_id: string
          quantity_after: number
          quantity_before: number
          quantity_delta: number
          reason: string
          reason_code?: string | null
          source_id?: string | null
          source_type?: string | null
          store_id: string
          unit_cost_minor?: number
          value_delta_minor?: number
          variant_id?: string | null
        }
        Update: {
          actor_employee_id?: string
          created_at?: string
          id?: string
          movement_type?: string
          organization_id?: string
          product_id?: string
          quantity_after?: number
          quantity_before?: number
          quantity_delta?: number
          reason?: string
          reason_code?: string | null
          source_id?: string | null
          source_type?: string | null
          store_id?: string
          unit_cost_minor?: number
          value_delta_minor?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_movements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_movements_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_movements_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      inventory_policies: {
        Row: {
          negative_stock_policy: string
          organization_id: string
          store_id: string
          updated_at: string
          updated_by_employee_id: string | null
        }
        Insert: {
          negative_stock_policy?: string
          organization_id: string
          store_id: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Update: {
          negative_stock_policy?: string
          organization_id?: string
          store_id?: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_policies_employee_organization_fkey"
            columns: ["updated_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_policies_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      inventory_replenishment_rules: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          preferred_warehouse_id: string | null
          product_id: string
          reorder_point: number
          store_id: string
          target_stock: number
          updated_at: string
          updated_by_employee_id: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          preferred_warehouse_id?: string | null
          product_id: string
          reorder_point: number
          store_id: string
          target_stock: number
          updated_at?: string
          updated_by_employee_id: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          preferred_warehouse_id?: string | null
          product_id?: string
          reorder_point?: number
          store_id?: string
          target_stock?: number
          updated_at?: string
          updated_by_employee_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_replenishment_rules_employee_organization_fkey"
            columns: ["updated_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_replenishment_rules_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_rules_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_rules_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_rules_warehouse_organization_fkey"
            columns: ["preferred_warehouse_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supply_chain_warehouses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      kitchen_order_items: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          kitchen_order_id: string
          line_number: number
          modifiers_snapshot: Json
          organization_id: string
          product_name_snapshot: string
          quantity: number
          ready_at: string | null
          sale_item_id: string
          started_at: string | null
          station: string
          status: string
          variant_name_snapshot: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          kitchen_order_id: string
          line_number: number
          modifiers_snapshot?: Json
          organization_id: string
          product_name_snapshot: string
          quantity: number
          ready_at?: string | null
          sale_item_id: string
          started_at?: string | null
          station?: string
          status?: string
          variant_name_snapshot?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          kitchen_order_id?: string
          line_number?: number
          modifiers_snapshot?: Json
          organization_id?: string
          product_name_snapshot?: string
          quantity?: number
          ready_at?: string | null
          sale_item_id?: string
          started_at?: string | null
          station?: string
          status?: string
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_order_items_order_organization_fkey"
            columns: ["kitchen_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "kitchen_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "kitchen_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_order_items_sale_item_organization_fkey"
            columns: ["sale_item_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      kitchen_orders: {
        Row: {
          completed_at: string | null
          created_at: string
          dining_option_name_snapshot: string
          id: string
          order_label: string
          order_note: string | null
          order_number: number
          organization_id: string
          priority: string
          ready_at: string | null
          register_id: string
          sale_id: string
          started_at: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          dining_option_name_snapshot: string
          id?: string
          order_label: string
          order_note?: string | null
          order_number: number
          organization_id: string
          priority?: string
          ready_at?: string | null
          register_id: string
          sale_id: string
          started_at?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          dining_option_name_snapshot?: string
          id?: string
          order_label?: string
          order_note?: string | null
          order_number?: number
          organization_id?: string
          priority?: string
          ready_at?: string | null
          register_id?: string
          sale_id?: string
          started_at?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_orders_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "kitchen_orders_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "kitchen_orders_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      kitchen_station_category_routes: {
        Row: {
          category_id: string
          created_at: string
          id: string
          organization_id: string
          station: string
          updated_at: string
          updated_by_employee_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          organization_id: string
          station: string
          updated_at?: string
          updated_by_employee_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          station?: string
          updated_at?: string
          updated_by_employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_station_category_routes_category_organization_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "kitchen_station_category_routes_employee_organization_fkey"
            columns: ["updated_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "kitchen_station_category_routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_card_events: {
        Row: {
          actor_employee_id: string
          created_at: string
          customer_id: string
          event_type: string
          id: string
          idempotency_key: string | null
          loyalty_card_id: string
          organization_id: string
          reason: string | null
          register_id: string | null
          sale_id: string | null
          stamp_count_after: number
          stamp_count_before: number
          stamp_delta: number
          store_id: string | null
        }
        Insert: {
          actor_employee_id: string
          created_at?: string
          customer_id: string
          event_type: string
          id?: string
          idempotency_key?: string | null
          loyalty_card_id: string
          organization_id: string
          reason?: string | null
          register_id?: string | null
          sale_id?: string | null
          stamp_count_after: number
          stamp_count_before: number
          stamp_delta?: number
          store_id?: string | null
        }
        Update: {
          actor_employee_id?: string
          created_at?: string
          customer_id?: string
          event_type?: string
          id?: string
          idempotency_key?: string | null
          loyalty_card_id?: string
          organization_id?: string
          reason?: string | null
          register_id?: string | null
          sale_id?: string | null
          stamp_count_after?: number
          stamp_count_before?: number
          stamp_delta?: number
          store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_card_events_actor_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_card_events_card_organization_fkey"
            columns: ["loyalty_card_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "loyalty_cards"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_card_events_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_card_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_card_events_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_card_events_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_card_events_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      loyalty_cards: {
        Row: {
          card_code: string
          created_at: string
          customer_id: string
          deactivated_at: string | null
          deactivation_reason: string | null
          expires_at: string | null
          id: string
          issued_at: string
          issued_by_employee_id: string
          organization_id: string
          replaces_card_id: string | null
          stamp_count: number
          stamp_target: number
          status: string
          updated_at: string
          verification_token_hash: string
        }
        Insert: {
          card_code: string
          created_at?: string
          customer_id: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by_employee_id: string
          organization_id: string
          replaces_card_id?: string | null
          stamp_count?: number
          stamp_target?: number
          status?: string
          updated_at?: string
          verification_token_hash: string
        }
        Update: {
          card_code?: string
          created_at?: string
          customer_id?: string
          deactivated_at?: string | null
          deactivation_reason?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          issued_by_employee_id?: string
          organization_id?: string
          replaces_card_id?: string | null
          stamp_count?: number
          stamp_target?: number
          status?: string
          updated_at?: string
          verification_token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_cards_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_cards_issued_by_organization_fkey"
            columns: ["issued_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_cards_replaces_card_fkey"
            columns: ["replaces_card_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "loyalty_cards"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      loyalty_programs: {
        Row: {
          created_at: string
          earn_points: number
          earn_spend_minor: number
          is_enabled: boolean
          minimum_redemption_points: number
          organization_id: string
          redemption_value_minor: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          earn_points?: number
          earn_spend_minor?: number
          is_enabled?: boolean
          minimum_redemption_points?: number
          organization_id: string
          redemption_value_minor?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          earn_points?: number
          earn_spend_minor?: number
          is_enabled?: boolean
          minimum_redemption_points?: number
          organization_id?: string
          redemption_value_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          customer_id: string
          entry_type: string
          id: string
          note: string | null
          organization_id: string
          points_delta: number
          refund_id: string | null
          sale_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id: string
          entry_type: string
          id?: string
          note?: string | null
          organization_id: string
          points_delta: number
          refund_id?: string | null
          sale_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string
          entry_type?: string
          id?: string
          note?: string | null
          organization_id?: string
          points_delta?: number
          refund_id?: string | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_transactions_refund_organization_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "loyalty_transactions_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          max_selections: number
          min_selections: number
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_groups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_options: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          modifier_group_id: string
          name: string
          organization_id: string
          price_adjustment_minor: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          modifier_group_id: string
          name: string
          organization_id: string
          price_adjustment_minor?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          modifier_group_id?: string
          name?: string
          organization_id?: string
          price_adjustment_minor?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_group_organization_fkey"
            columns: ["modifier_group_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      offline_sync_events: {
        Row: {
          attempt_count: number
          conflict_type: string | null
          created_at: string
          device_id: string | null
          device_name_snapshot: string | null
          employee_id: string
          employee_name_snapshot: string
          failure_message: string | null
          id: string
          idempotency_key: string
          last_attempt_at: string
          local_created_at: string | null
          local_receipt_reference: string
          official_receipt_number: number | null
          organization_id: string
          register_id: string
          register_name_snapshot: string
          shift_id: string | null
          state: string
          store_id: string
          store_name_snapshot: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          conflict_type?: string | null
          created_at?: string
          device_id?: string | null
          device_name_snapshot?: string | null
          employee_id: string
          employee_name_snapshot: string
          failure_message?: string | null
          id?: string
          idempotency_key: string
          last_attempt_at?: string
          local_created_at?: string | null
          local_receipt_reference: string
          official_receipt_number?: number | null
          organization_id: string
          register_id: string
          register_name_snapshot: string
          shift_id?: string | null
          state: string
          store_id: string
          store_name_snapshot: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          conflict_type?: string | null
          created_at?: string
          device_id?: string | null
          device_name_snapshot?: string | null
          employee_id?: string
          employee_name_snapshot?: string
          failure_message?: string | null
          id?: string
          idempotency_key?: string
          last_attempt_at?: string
          local_created_at?: string | null
          local_receipt_reference?: string
          official_receipt_number?: number | null
          organization_id?: string
          register_id?: string
          register_name_snapshot?: string
          shift_id?: string | null
          state?: string
          store_id?: string
          store_name_snapshot?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_sync_events_device_organization_fkey"
            columns: ["device_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "pos_devices"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "offline_sync_events_employee_organization_fkey"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "offline_sync_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sync_events_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "offline_sync_events_shift_organization_fkey"
            columns: ["shift_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "offline_sync_events_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      open_tickets: {
        Row: {
          assigned_employee_id: string
          cart: Json
          created_at: string
          customer_id: string | null
          dining_option_id: string | null
          id: string
          label: string
          merged_into_ticket_id: string | null
          note: string | null
          opened_by_employee_id: string
          organization_id: string
          register_id: string
          sale_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          assigned_employee_id: string
          cart: Json
          created_at?: string
          customer_id?: string | null
          dining_option_id?: string | null
          id?: string
          label: string
          merged_into_ticket_id?: string | null
          note?: string | null
          opened_by_employee_id: string
          organization_id: string
          register_id: string
          sale_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          assigned_employee_id?: string
          cart?: Json
          created_at?: string
          customer_id?: string | null
          dining_option_id?: string | null
          id?: string
          label?: string
          merged_into_ticket_id?: string | null
          note?: string | null
          opened_by_employee_id?: string
          organization_id?: string
          register_id?: string
          sale_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_tickets_assigned_employee_organization_fkey"
            columns: ["assigned_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_dining_option_organization_fkey"
            columns: ["dining_option_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "dining_options"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_employee_organization_fkey"
            columns: ["opened_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_merged_into_organization_fkey"
            columns: ["merged_into_ticket_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "open_tickets"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_tickets_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "open_tickets_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      organization_export_sessions: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivered_record_count: number | null
          delivery_manifest: Json
          expires_at: string
          id: string
          organization_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivered_record_count?: number | null
          delivery_manifest?: Json
          expires_at: string
          id?: string
          organization_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivered_record_count?: number | null
          delivery_manifest?: Json
          expires_at?: string
          id?: string
          organization_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_export_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_export_sessions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_features: {
        Row: {
          created_at: string
          feature_key: string
          is_enabled: boolean
          organization_id: string
          updated_at: string
          updated_by_employee_id: string | null
        }
        Insert: {
          created_at?: string
          feature_key: string
          is_enabled?: boolean
          organization_id: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Update: {
          created_at?: string
          feature_key?: string
          is_enabled?: boolean
          organization_id?: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_features_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_features_updated_by_employee_fkey"
            columns: ["updated_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      organization_rate_limit_windows: {
        Row: {
          action_code: string
          created_at: string
          organization_id: string
          profile_id: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          action_code: string
          created_at?: string
          organization_id: string
          profile_id: string
          request_count?: number
          updated_at?: string
          window_started_at: string
        }
        Update: {
          action_code?: string
          created_at?: string
          organization_id?: string
          profile_id?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_rate_limit_windows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_rate_limit_windows_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_usage_daily: {
        Row: {
          active_employee_count: number
          active_product_count: number
          active_store_count: number
          captured_at: string
          completed_sale_count: number
          completed_sales_total_minor: number
          customer_count: number
          organization_id: string
          pending_offline_sync_count: number
          usage_date: string
        }
        Insert: {
          active_employee_count?: number
          active_product_count?: number
          active_store_count?: number
          captured_at?: string
          completed_sale_count?: number
          completed_sales_total_minor?: number
          customer_count?: number
          organization_id: string
          pending_offline_sync_count?: number
          usage_date: string
        }
        Update: {
          active_employee_count?: number
          active_product_count?: number
          active_store_count?: number
          captured_at?: string
          completed_sale_count?: number
          completed_sales_total_minor?: number
          customer_count?: number
          organization_id?: string
          pending_offline_sync_count?: number
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_usage_daily_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          archive_requested_at: string | null
          archive_requested_by_employee_id: string | null
          archived_at: string | null
          business_type: string
          created_at: string
          created_by: string
          currency_code: string
          device_management_enabled: boolean
          id: string
          name: string
          show_expected_cash_before_close: boolean
          status: string
          suspended_at: string | null
          suspension_reason: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          archive_requested_at?: string | null
          archive_requested_by_employee_id?: string | null
          archived_at?: string | null
          business_type?: string
          created_at?: string
          created_by: string
          currency_code?: string
          device_management_enabled?: boolean
          id?: string
          name: string
          show_expected_cash_before_close?: boolean
          status?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          archive_requested_at?: string | null
          archive_requested_by_employee_id?: string | null
          archived_at?: string | null
          business_type?: string
          created_at?: string
          created_by?: string
          currency_code?: string
          device_management_enabled?: boolean
          id?: string
          name?: string
          show_expected_cash_before_close?: boolean
          status?: string
          suspended_at?: string | null
          suspension_reason?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_archive_request_actor_fkey"
            columns: ["archive_requested_by_employee_id", "id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          code: string
          created_at: string
          id: string
          is_enabled: boolean
          is_loyalty_redemption: boolean
          name: string
          offline_policy: string
          organization_id: string
          payment_type: string
          requires_reference: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_loyalty_redemption?: boolean
          name: string
          offline_policy?: string
          organization_id: string
          payment_type: string
          requires_reference?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          is_loyalty_redemption?: boolean
          name?: string
          offline_policy?: string
          organization_id?: string
          payment_type?: string
          requires_reference?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          amount_tendered_minor: number | null
          change_given_minor: number | null
          created_at: string
          id: string
          note: string | null
          organization_id: string
          payment_method_code_snapshot: string
          payment_method_id: string
          payment_method_name_snapshot: string
          payment_method_type_snapshot: string
          reference_number: string | null
          sale_id: string
        }
        Insert: {
          amount_minor: number
          amount_tendered_minor?: number | null
          change_given_minor?: number | null
          created_at?: string
          id?: string
          note?: string | null
          organization_id: string
          payment_method_code_snapshot: string
          payment_method_id: string
          payment_method_name_snapshot: string
          payment_method_type_snapshot: string
          reference_number?: string | null
          sale_id: string
        }
        Update: {
          amount_minor?: number
          amount_tendered_minor?: number | null
          change_given_minor?: number | null
          created_at?: string
          id?: string
          note?: string | null
          organization_id?: string
          payment_method_code_snapshot?: string
          payment_method_id?: string
          payment_method_name_snapshot?: string
          payment_method_type_snapshot?: string
          reference_number?: string | null
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_method_organization_fkey"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "payments_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      permissions: {
        Row: {
          category: string
          code: string
          description: string
          name: string
        }
        Insert: {
          category: string
          code: string
          description: string
          name: string
        }
        Update: {
          category?: string
          code?: string
          description?: string
          name?: string
        }
        Relationships: []
      }
      pos_devices: {
        Row: {
          app_version: string
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          organization_id: string
          register_id: string
          registered_by_employee_id: string
          revoked_at: string | null
          revoked_by_employee_id: string | null
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          app_version?: string
          created_at?: string
          id: string
          last_seen_at?: string | null
          name: string
          organization_id: string
          register_id: string
          registered_by_employee_id: string
          revoked_at?: string | null
          revoked_by_employee_id?: string | null
          status?: string
          store_id: string
          updated_at?: string
        }
        Update: {
          app_version?: string
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          organization_id?: string
          register_id?: string
          registered_by_employee_id?: string
          revoked_at?: string | null
          revoked_by_employee_id?: string | null
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_devices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_devices_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_devices_registered_by_organization_fkey"
            columns: ["registered_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_devices_revoked_by_organization_fkey"
            columns: ["revoked_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_devices_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      pos_favorite_tiles: {
        Row: {
          created_at: string
          created_by_employee_id: string
          id: string
          organization_id: string
          position: number
          product_id: string
          store_id: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_employee_id: string
          id?: string
          organization_id: string
          position: number
          product_id: string
          store_id: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_employee_id?: string
          id?: string
          organization_id?: string
          position?: number
          product_id?: string
          store_id?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_favorite_tiles_created_by_organization_fkey"
            columns: ["created_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_favorite_tiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_favorite_tiles_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_favorite_tiles_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "pos_favorite_tiles_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      product_components: {
        Row: {
          component_product_id: string
          component_variant_id: string | null
          created_at: string
          id: string
          organization_id: string
          product_id: string
          quantity_per_composite: number
          updated_at: string
        }
        Insert: {
          component_product_id: string
          component_variant_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          product_id: string
          quantity_per_composite: number
          updated_at?: string
        }
        Update: {
          component_product_id?: string
          component_variant_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          product_id?: string
          quantity_per_composite?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_components_component_organization_fkey"
            columns: ["component_product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_components_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_components_parent_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_components_variant_organization_fkey"
            columns: [
              "component_variant_id",
              "component_product_id",
              "organization_id",
            ]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      product_modifier_groups: {
        Row: {
          created_at: string
          modifier_group_id: string
          organization_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          modifier_group_id: string
          organization_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          modifier_group_id?: string
          organization_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_groups_group_organization_fkey"
            columns: ["modifier_group_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_store_settings: {
        Row: {
          created_at: string
          is_available: boolean
          low_stock_level: number | null
          organization_id: string
          price_override_minor: number | null
          product_id: string
          restock_policy: "do_not_restock" | "restock"
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          is_available?: boolean
          low_stock_level?: number | null
          organization_id: string
          price_override_minor?: number | null
          product_id: string
          restock_policy?: "do_not_restock" | "restock"
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          is_available?: boolean
          low_stock_level?: number | null
          organization_id?: string
          price_override_minor?: number | null
          product_id?: string
          restock_policy?: "do_not_restock" | "restock"
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_store_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_store_settings_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "product_store_settings_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_units: {
        Row: {
          created_at: string
          factor_to_base: number
          id: string
          is_base: boolean
          is_purchase_unit: boolean
          is_sale_unit: boolean
          organization_id: string
          product_id: string
          unit_code: string
          unit_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          factor_to_base: number
          id?: string
          is_base?: boolean
          is_purchase_unit?: boolean
          is_sale_unit?: boolean
          organization_id: string
          product_id: string
          unit_code: string
          unit_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          factor_to_base?: number
          id?: string
          is_base?: boolean
          is_purchase_unit?: boolean
          is_sale_unit?: boolean
          organization_id?: string
          product_id?: string
          unit_code?: string
          unit_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_units_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          cost_minor: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          option_values: Json
          organization_id: string
          price_minor: number
          product_id: string
          sku: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          cost_minor?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          option_values?: Json
          organization_id: string
          price_minor: number
          product_id: string
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          cost_minor?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          option_values?: Json
          organization_id?: string
          price_minor?: number
          product_id?: string
          sku?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      production_runs: {
        Row: {
          id: string
          note: string | null
          organization_id: string
          produced_at: string
          produced_by_employee_id: string
          product_id: string
          quantity_produced: number
          store_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          organization_id: string
          produced_at?: string
          produced_by_employee_id: string
          product_id: string
          quantity_produced: number
          store_id: string
        }
        Update: {
          id?: string
          note?: string | null
          organization_id?: string
          produced_at?: string
          produced_by_employee_id?: string
          product_id?: string
          quantity_produced?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_runs_employee_organization_fkey"
            columns: ["produced_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "production_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_runs_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "production_runs_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      products: {
        Row: {
          allow_fractional_quantity: boolean
          barcode: string | null
          category_id: string | null
          cost_minor: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_composite: boolean
          is_variable_price: boolean
          name: string
          organization_id: string
          price_minor: number
          product_type: string
          sku: string | null
          status: string
          track_inventory: boolean
          unit: string
          updated_at: string
        }
        Insert: {
          allow_fractional_quantity?: boolean
          barcode?: string | null
          category_id?: string | null
          cost_minor?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_composite?: boolean
          is_variable_price?: boolean
          name: string
          organization_id: string
          price_minor?: number
          product_type?: string
          sku?: string | null
          status?: string
          track_inventory?: boolean
          unit?: string
          updated_at?: string
        }
        Update: {
          allow_fractional_quantity?: boolean
          barcode?: string | null
          category_id?: string | null
          cost_minor?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_composite?: boolean
          is_variable_price?: boolean
          name?: string
          organization_id?: string
          price_minor?: number
          product_type?: string
          sku?: string | null
          status?: string
          track_inventory?: boolean
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_organization_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_lines: {
        Row: {
          id: string
          ordered_quantity: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          purchase_order_id: string
          received_quantity: number
          unit_cost_minor: number
          unit_snapshot: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          id?: string
          ordered_quantity: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          purchase_order_id: string
          received_quantity?: number
          unit_cost_minor?: number
          unit_snapshot: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          id?: string
          ordered_quantity?: number
          organization_id?: string
          product_id?: string
          product_name_snapshot?: string
          purchase_order_id?: string
          received_quantity?: number
          unit_cost_minor?: number
          unit_snapshot?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_order_organization_fkey"
            columns: ["purchase_order_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_order_lines_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by_employee_id: string
          expected_at: string | null
          id: string
          notes: string | null
          order_number: number
          ordered_at: string | null
          organization_id: string
          received_at: string | null
          received_by_employee_id: string | null
          status: string
          store_id: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_employee_id: string
          expected_at?: string | null
          id?: string
          notes?: string | null
          order_number: number
          ordered_at?: string | null
          organization_id: string
          received_at?: string | null
          received_by_employee_id?: string | null
          status?: string
          store_id: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_employee_id?: string
          expected_at?: string | null
          id?: string
          notes?: string | null
          order_number?: number
          ordered_at?: string | null
          organization_id?: string
          received_at?: string | null
          received_by_employee_id?: string | null
          status?: string
          store_id?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_creator_organization_fkey"
            columns: ["created_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_receiver_organization_fkey"
            columns: ["received_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_organization_fkey"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      receipt_delivery_requests: {
        Row: {
          created_at: string
          delivered_at: string | null
          delivery_channel: string
          failed_at: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          organization_id: string
          provider_message_id: string | null
          receipt_id: string
          recipient: string
          requested_by_employee_id: string
          status: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          delivery_channel: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          provider_message_id?: string | null
          receipt_id: string
          recipient: string
          requested_by_employee_id: string
          status?: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          delivery_channel?: string
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          provider_message_id?: string | null
          receipt_id?: string
          recipient?: string
          requested_by_employee_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_delivery_requests_employee_organization_fkey"
            columns: ["requested_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "receipt_delivery_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_delivery_requests_receipt_organization_fkey"
            columns: ["receipt_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      receipt_settings: {
        Row: {
          business_address: string | null
          business_email: string | null
          business_name: string
          business_phone: string | null
          business_tax_id: string | null
          business_website: string | null
          created_at: string
          footer_message: string
          header_message: string | null
          organization_id: string
          paper_width_mm: number
          show_cashier: boolean
          show_payment_details: boolean
          show_register: boolean
          show_store_address: boolean
          show_store_phone: boolean
          updated_at: string
        }
        Insert: {
          business_address?: string | null
          business_email?: string | null
          business_name: string
          business_phone?: string | null
          business_tax_id?: string | null
          business_website?: string | null
          created_at?: string
          footer_message?: string
          header_message?: string | null
          organization_id: string
          paper_width_mm?: number
          show_cashier?: boolean
          show_payment_details?: boolean
          show_register?: boolean
          show_store_address?: boolean
          show_store_phone?: boolean
          updated_at?: string
        }
        Update: {
          business_address?: string | null
          business_email?: string | null
          business_name?: string
          business_phone?: string | null
          business_tax_id?: string | null
          business_website?: string | null
          created_at?: string
          footer_message?: string
          header_message?: string | null
          organization_id?: string
          paper_width_mm?: number
          show_cashier?: boolean
          show_payment_details?: boolean
          show_register?: boolean
          show_store_address?: boolean
          show_store_phone?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          id: string
          issued_at: string
          organization_id: string
          receipt_layout_snapshot: Json | null
          receipt_number: number
          sale_id: string
        }
        Insert: {
          id?: string
          issued_at?: string
          organization_id: string
          receipt_layout_snapshot?: Json | null
          receipt_number: number
          sale_id: string
        }
        Update: {
          id?: string
          issued_at?: string
          organization_id?: string
          receipt_layout_snapshot?: Json | null
          receipt_number?: number
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      refund_items: {
        Row: {
          created_at: string
          id: string
          line_total_minor: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          refund_id: string
          sale_item_id: string
          sku_snapshot: string | null
          unit_price_minor: number
          unit_snapshot: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_minor: number
          organization_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          refund_id: string
          sale_item_id: string
          sku_snapshot?: string | null
          unit_price_minor: number
          unit_snapshot: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          line_total_minor?: number
          organization_id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          refund_id?: string
          sale_item_id?: string
          sku_snapshot?: string | null
          unit_price_minor?: number
          unit_snapshot?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_items_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refund_items_refund_organization_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refund_items_sale_item_id_fkey"
            columns: ["sale_item_id"]
            isOneToOne: false
            referencedRelation: "sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_items_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      refund_payments: {
        Row: {
          amount_minor: number
          created_at: string
          id: string
          organization_id: string
          payment_method_code_snapshot: string
          payment_method_id: string
          payment_method_name_snapshot: string
          payment_method_type_snapshot: string
          reference_number: string | null
          refund_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          id?: string
          organization_id: string
          payment_method_code_snapshot: string
          payment_method_id: string
          payment_method_name_snapshot: string
          payment_method_type_snapshot: string
          reference_number?: string | null
          refund_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          id?: string
          organization_id?: string
          payment_method_code_snapshot?: string
          payment_method_id?: string
          payment_method_name_snapshot?: string
          payment_method_type_snapshot?: string
          reference_number?: string | null
          refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_payments_method_organization_fkey"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refund_payments_refund_organization_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      refund_requests: {
        Row: {
          actor_employee_id: string
          completed_at: string | null
          created_at: string
          id: string
          idempotency_key: string
          organization_id: string
          refund_id: string | null
          request_payload: Json
          state: string
        }
        Insert: {
          actor_employee_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          organization_id: string
          refund_id?: string | null
          request_payload: Json
          state?: string
        }
        Update: {
          actor_employee_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          refund_id?: string | null
          request_payload?: Json
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_actor_organization_fkey"
            columns: ["actor_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refund_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_refund_organization_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      refunds: {
        Row: {
          completed_at: string
          created_at: string
          currency_code: string
          id: string
          organization_id: string
          reason: string
          refund_number: number
          refunded_by_employee_id: string
          register_id: string
          sale_id: string
          shift_id: string | null
          status: string
          store_id: string
          total_minor: number
        }
        Insert: {
          completed_at?: string
          created_at?: string
          currency_code: string
          id?: string
          organization_id: string
          reason: string
          refund_number: number
          refunded_by_employee_id: string
          register_id: string
          sale_id: string
          shift_id?: string | null
          status?: string
          store_id: string
          total_minor?: number
        }
        Update: {
          completed_at?: string
          created_at?: string
          currency_code?: string
          id?: string
          organization_id?: string
          reason?: string
          refund_number?: number
          refunded_by_employee_id?: string
          register_id?: string
          sale_id?: string
          shift_id?: string | null
          status?: string
          store_id?: string
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "refunds_employee_organization_fkey"
            columns: ["refunded_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refunds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refunds_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refunds_shift_organization_fkey"
            columns: ["shift_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "refunds_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      registers: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "registers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "registers_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          organization_id: string
          permission_code: string
          role_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          permission_code: string
          role_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          permission_code?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_permission_code_fkey"
            columns: ["permission_code"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "role_permissions_role_organization_fkey"
            columns: ["role_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      roles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_exchanges: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          linked_by_employee_id: string
          organization_id: string
          refund_id: string
          replacement_sale_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          linked_by_employee_id: string
          organization_id: string
          refund_id: string
          replacement_sale_id: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          linked_by_employee_id?: string
          organization_id?: string
          refund_id?: string
          replacement_sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_exchanges_employee_organization_fkey"
            columns: ["linked_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_exchanges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_exchanges_refund_organization_fkey"
            columns: ["refund_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_exchanges_replacement_sale_organization_fkey"
            columns: ["replacement_sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      sale_items: {
        Row: {
          cogs_minor: number
          created_at: string
          discount_minor: number
          id: string
          item_note: string | null
          line_total_minor: number
          modifier_total_minor: number
          modifiers_snapshot: Json
          organization_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          sale_id: string
          sku_snapshot: string | null
          tax_minor: number
          unit_cost_minor: number
          unit_price_minor: number
          unit_snapshot: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          cogs_minor?: number
          created_at?: string
          discount_minor?: number
          id?: string
          item_note?: string | null
          line_total_minor: number
          modifier_total_minor?: number
          modifiers_snapshot?: Json
          organization_id: string
          product_id: string
          product_name_snapshot: string
          quantity: number
          sale_id: string
          sku_snapshot?: string | null
          tax_minor?: number
          unit_cost_minor?: number
          unit_price_minor: number
          unit_snapshot: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          cogs_minor?: number
          created_at?: string
          discount_minor?: number
          id?: string
          item_note?: string | null
          line_total_minor?: number
          modifier_total_minor?: number
          modifiers_snapshot?: Json
          organization_id?: string
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          sale_id?: string
          sku_snapshot?: string | null
          tax_minor?: number
          unit_cost_minor?: number
          unit_price_minor?: number
          unit_snapshot?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_items_sale_organization_fkey"
            columns: ["sale_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sale_items_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_employee_id: string
          cashier_name_snapshot: string
          completed_at: string
          created_at: string
          currency_code: string
          customer_id: string | null
          dining_option_id: string | null
          dining_option_name_snapshot: string | null
          discount_id: string | null
          discount_minor: number
          discount_name_snapshot: string | null
          id: string
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          loyalty_redemption_minor: number
          open_ticket_id: string | null
          organization_id: string
          organization_name_snapshot: string
          register_id: string
          register_name_snapshot: string
          shift_id: string | null
          status: string
          store_id: string
          store_name_snapshot: string
          subtotal_minor: number
          tax_is_inclusive: boolean
          tax_minor: number
          tax_name_snapshot: string | null
          tax_rate_id: string | null
          total_minor: number
        }
        Insert: {
          cashier_employee_id: string
          cashier_name_snapshot: string
          completed_at?: string
          created_at?: string
          currency_code: string
          customer_id?: string | null
          dining_option_id?: string | null
          dining_option_name_snapshot?: string | null
          discount_id?: string | null
          discount_minor?: number
          discount_name_snapshot?: string | null
          id?: string
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_minor?: number
          open_ticket_id?: string | null
          organization_id: string
          organization_name_snapshot: string
          register_id: string
          register_name_snapshot: string
          shift_id?: string | null
          status?: string
          store_id: string
          store_name_snapshot: string
          subtotal_minor?: number
          tax_is_inclusive?: boolean
          tax_minor?: number
          tax_name_snapshot?: string | null
          tax_rate_id?: string | null
          total_minor?: number
        }
        Update: {
          cashier_employee_id?: string
          cashier_name_snapshot?: string
          completed_at?: string
          created_at?: string
          currency_code?: string
          customer_id?: string | null
          dining_option_id?: string | null
          dining_option_name_snapshot?: string | null
          discount_id?: string | null
          discount_minor?: number
          discount_name_snapshot?: string | null
          id?: string
          loyalty_points_earned?: number
          loyalty_points_redeemed?: number
          loyalty_redemption_minor?: number
          open_ticket_id?: string | null
          organization_id?: string
          organization_name_snapshot?: string
          register_id?: string
          register_name_snapshot?: string
          shift_id?: string | null
          status?: string
          store_id?: string
          store_name_snapshot?: string
          subtotal_minor?: number
          tax_is_inclusive?: boolean
          tax_minor?: number
          tax_name_snapshot?: string | null
          tax_rate_id?: string | null
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_cashier_organization_fkey"
            columns: ["cashier_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_customer_organization_fkey"
            columns: ["customer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_dining_option_organization_fkey"
            columns: ["dining_option_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "dining_options"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_discount_organization_fkey"
            columns: ["discount_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "discounts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_open_ticket_organization_fkey"
            columns: ["open_ticket_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "open_tickets"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_shift_organization_fkey"
            columns: ["shift_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "sales_tax_rate_organization_fkey"
            columns: ["tax_rate_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      shifts: {
        Row: {
          closed_at: string | null
          closed_by_employee_id: string | null
          closing_note: string | null
          counted_cash_minor: number | null
          created_at: string
          difference_minor: number | null
          expected_cash_minor: number | null
          id: string
          opened_at: string
          opened_by_employee_id: string
          opening_cash_minor: number
          opening_note: string | null
          organization_id: string
          register_id: string
          status: string
          store_id: string
        }
        Insert: {
          closed_at?: string | null
          closed_by_employee_id?: string | null
          closing_note?: string | null
          counted_cash_minor?: number | null
          created_at?: string
          difference_minor?: number | null
          expected_cash_minor?: number | null
          id?: string
          opened_at?: string
          opened_by_employee_id: string
          opening_cash_minor?: number
          opening_note?: string | null
          organization_id: string
          register_id: string
          status?: string
          store_id: string
        }
        Update: {
          closed_at?: string | null
          closed_by_employee_id?: string | null
          closing_note?: string | null
          counted_cash_minor?: number | null
          created_at?: string
          difference_minor?: number | null
          expected_cash_minor?: number | null
          id?: string
          opened_at?: string
          opened_by_employee_id?: string
          opening_cash_minor?: number
          opening_note?: string | null
          organization_id?: string
          register_id?: string
          status?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_organization_fkey"
            columns: ["closed_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "shifts_opened_by_organization_fkey"
            columns: ["opened_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_register_organization_fkey"
            columns: ["register_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "registers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "shifts_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      smart_menu_categories: {
        Row: {
          category_id: string
          created_at: string
          organization_id: string
          smart_menu_id: string
          sort_order: number
        }
        Insert: {
          category_id: string
          created_at?: string
          organization_id: string
          smart_menu_id: string
          sort_order?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          organization_id?: string
          smart_menu_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_menu_categories_category_organization_fkey"
            columns: ["category_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "smart_menu_categories_menu_organization_fkey"
            columns: ["smart_menu_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "smart_menus"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      smart_menu_products: {
        Row: {
          created_at: string
          organization_id: string
          product_id: string
          smart_menu_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          organization_id: string
          product_id: string
          smart_menu_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          organization_id?: string
          product_id?: string
          smart_menu_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "smart_menu_products_menu_organization_fkey"
            columns: ["smart_menu_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "smart_menus"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "smart_menu_products_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      smart_menus: {
        Row: {
          created_at: string
          created_by_employee_id: string | null
          id: string
          is_enabled: boolean
          organization_id: string
          show_images: boolean
          show_modifiers: boolean
          show_prices: boolean
          show_unavailable: boolean
          show_variants: boolean
          store_id: string
          updated_at: string
          updated_by_employee_id: string | null
        }
        Insert: {
          created_at?: string
          created_by_employee_id?: string | null
          id?: string
          is_enabled?: boolean
          organization_id: string
          show_images?: boolean
          show_modifiers?: boolean
          show_prices?: boolean
          show_unavailable?: boolean
          show_variants?: boolean
          store_id: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Update: {
          created_at?: string
          created_by_employee_id?: string | null
          id?: string
          is_enabled?: boolean
          organization_id?: string
          show_images?: boolean
          show_modifiers?: boolean
          show_prices?: boolean
          show_unavailable?: boolean
          show_variants?: boolean
          store_id?: string
          updated_at?: string
          updated_by_employee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smart_menus_created_by_organization_fkey"
            columns: ["created_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "smart_menus_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smart_menus_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "smart_menus_updated_by_organization_fkey"
            columns: ["updated_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_request_discrepancies: {
        Row: {
          id: string
          note: string
          organization_id: string
          reported_at: string
          reported_by_employee_id: string
          short_quantity: number
          stock_request_id: string
          stock_request_line_id: string
          stock_transfer_line_id: string
        }
        Insert: {
          id?: string
          note: string
          organization_id: string
          reported_at?: string
          reported_by_employee_id: string
          short_quantity: number
          stock_request_id: string
          stock_request_line_id: string
          stock_transfer_line_id: string
        }
        Update: {
          id?: string
          note?: string
          organization_id?: string
          reported_at?: string
          reported_by_employee_id?: string
          short_quantity?: number
          stock_request_id?: string
          stock_request_line_id?: string
          stock_transfer_line_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_request_discrepancies_employee_organization_fkey"
            columns: ["reported_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_request_discrepancies_request_line_organization_fkey"
            columns: ["stock_request_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_request_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_request_discrepancies_request_organization_fkey"
            columns: ["stock_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_request_discrepancies_transfer_line_organization_fkey"
            columns: ["stock_transfer_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_transfer_lines"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_request_lines: {
        Row: {
          approved_quantity: number
          dispatched_quantity: number
          id: string
          organization_id: string
          picked_quantity: number
          product_id: string
          product_name_snapshot: string
          received_quantity: number
          requested_quantity: number
          short_quantity: number
          stock_request_id: string
          unit_snapshot: string
          variant_id: string | null
          variant_name_snapshot: string | null
        }
        Insert: {
          approved_quantity?: number
          dispatched_quantity?: number
          id?: string
          organization_id: string
          picked_quantity?: number
          product_id: string
          product_name_snapshot: string
          received_quantity?: number
          requested_quantity: number
          short_quantity?: number
          stock_request_id: string
          unit_snapshot: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Update: {
          approved_quantity?: number
          dispatched_quantity?: number
          id?: string
          organization_id?: string
          picked_quantity?: number
          product_id?: string
          product_name_snapshot?: string
          received_quantity?: number
          requested_quantity?: number
          short_quantity?: number
          stock_request_id?: string
          unit_snapshot?: string
          variant_id?: string | null
          variant_name_snapshot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_request_lines_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_request_lines_request_organization_fkey"
            columns: ["stock_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_request_lines_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_requests: {
        Row: {
          approved_at: string | null
          approved_by_employee_id: string | null
          cancelled_at: string | null
          cancelled_by_employee_id: string | null
          created_at: string
          dispatched_at: string | null
          dispatched_by_employee_id: string | null
          id: string
          note: string | null
          organization_id: string
          picked_at: string | null
          picked_by_employee_id: string | null
          received_at: string | null
          received_by_employee_id: string | null
          request_number: number
          requested_at: string
          requested_by_employee_id: string
          requesting_store_id: string
          source_warehouse_id: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by_employee_id?: string | null
          cancelled_at?: string | null
          cancelled_by_employee_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          dispatched_by_employee_id?: string | null
          id?: string
          note?: string | null
          organization_id: string
          picked_at?: string | null
          picked_by_employee_id?: string | null
          received_at?: string | null
          received_by_employee_id?: string | null
          request_number: number
          requested_at?: string
          requested_by_employee_id: string
          requesting_store_id: string
          source_warehouse_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by_employee_id?: string | null
          cancelled_at?: string | null
          cancelled_by_employee_id?: string | null
          created_at?: string
          dispatched_at?: string | null
          dispatched_by_employee_id?: string | null
          id?: string
          note?: string | null
          organization_id?: string
          picked_at?: string | null
          picked_by_employee_id?: string | null
          received_at?: string | null
          received_by_employee_id?: string | null
          request_number?: number
          requested_at?: string
          requested_by_employee_id?: string
          requesting_store_id?: string
          source_warehouse_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_requests_approved_by_organization_fkey"
            columns: ["approved_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_cancelled_by_organization_fkey"
            columns: ["cancelled_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_dispatched_by_organization_fkey"
            columns: ["dispatched_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_requests_picked_by_organization_fkey"
            columns: ["picked_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_received_by_organization_fkey"
            columns: ["received_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_requested_by_organization_fkey"
            columns: ["requested_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_store_organization_fkey"
            columns: ["requesting_store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_requests_warehouse_organization_fkey"
            columns: ["source_warehouse_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supply_chain_warehouses"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          id: string
          organization_id: string
          product_id: string
          quantity: number
          received_quantity: number
          short_quantity: number
          stock_request_line_id: string | null
          stock_transfer_id: string
          unit_cost_minor: number
          variant_id: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          product_id: string
          quantity: number
          received_quantity?: number
          short_quantity?: number
          stock_request_line_id?: string | null
          stock_transfer_id: string
          unit_cost_minor?: number
          variant_id?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          received_quantity?: number
          short_quantity?: number
          stock_request_line_id?: string | null
          stock_transfer_id?: string
          unit_cost_minor?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_request_line_organization_fkey"
            columns: ["stock_request_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_request_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_organization_fkey"
            columns: ["stock_transfer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      stock_transfer_receipt_lines: {
        Row: {
          id: string
          organization_id: string
          quantity_received: number
          stock_transfer_line_id: string
          stock_transfer_receipt_id: string
        }
        Insert: {
          id?: string
          organization_id: string
          quantity_received: number
          stock_transfer_line_id: string
          stock_transfer_receipt_id: string
        }
        Update: {
          id?: string
          organization_id?: string
          quantity_received?: number
          stock_transfer_line_id?: string
          stock_transfer_receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_receipt_lines_line_organization_fkey"
            columns: ["stock_transfer_line_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_transfer_lines"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_receipt_lines_receipt_organization_fkey"
            columns: ["stock_transfer_receipt_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_transfer_receipts"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_transfer_receipts: {
        Row: {
          destination_store_id: string
          id: string
          note: string | null
          organization_id: string
          received_at: string
          received_by_employee_id: string
          stock_transfer_id: string
        }
        Insert: {
          destination_store_id: string
          id?: string
          note?: string | null
          organization_id: string
          received_at?: string
          received_by_employee_id: string
          stock_transfer_id: string
        }
        Update: {
          destination_store_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          received_at?: string
          received_by_employee_id?: string
          stock_transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_receipts_employee_organization_fkey"
            columns: ["received_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_receipts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_receipts_store_organization_fkey"
            columns: ["destination_store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfer_receipts_transfer_organization_fkey"
            columns: ["stock_transfer_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          completed_at: string
          destination_store_id: string
          id: string
          note: string | null
          organization_id: string
          received_at: string | null
          received_by_employee_id: string | null
          source_store_id: string
          status: string
          stock_request_id: string | null
          transferred_by_employee_id: string
        }
        Insert: {
          completed_at?: string
          destination_store_id: string
          id?: string
          note?: string | null
          organization_id: string
          received_at?: string | null
          received_by_employee_id?: string | null
          source_store_id: string
          status?: string
          stock_request_id?: string | null
          transferred_by_employee_id: string
        }
        Update: {
          completed_at?: string
          destination_store_id?: string
          id?: string
          note?: string | null
          organization_id?: string
          received_at?: string | null
          received_by_employee_id?: string | null
          source_store_id?: string
          status?: string
          stock_request_id?: string | null
          transferred_by_employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_destination_organization_fkey"
            columns: ["destination_store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfers_employee_organization_fkey"
            columns: ["transferred_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_receiver_organization_fkey"
            columns: ["received_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfers_request_organization_fkey"
            columns: ["stock_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stock_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "stock_transfers_source_organization_fkey"
            columns: ["source_store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      store_payment_methods: {
        Row: {
          created_at: string
          is_enabled: boolean
          organization_id: string
          payment_method_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          is_enabled?: boolean
          organization_id: string
          payment_method_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          is_enabled?: boolean
          organization_id?: string
          payment_method_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_payment_methods_method_organization_fkey"
            columns: ["payment_method_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "store_payment_methods_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      stores: {
        Row: {
          address: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_return_lines: {
        Row: {
          id: string
          organization_id: string
          product_id: string
          quantity: number
          supplier_return_id: string
          unit_cost_minor: number
          variant_id: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          product_id: string
          quantity: number
          supplier_return_id: string
          unit_cost_minor: number
          variant_id?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          supplier_return_id?: string
          unit_cost_minor?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_return_lines_product_organization_fkey"
            columns: ["product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_return_lines_return_organization_fkey"
            columns: ["supplier_return_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "supplier_returns"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_return_lines_variant_product_organization_fkey"
            columns: ["variant_id", "product_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id", "product_id", "organization_id"]
          },
        ]
      }
      supplier_returns: {
        Row: {
          id: string
          note: string | null
          organization_id: string
          returned_at: string
          returned_by_employee_id: string
          store_id: string
          supplier_id: string
        }
        Insert: {
          id?: string
          note?: string | null
          organization_id: string
          returned_at?: string
          returned_by_employee_id: string
          store_id: string
          supplier_id: string
        }
        Update: {
          id?: string
          note?: string | null
          organization_id?: string
          returned_at?: string
          returned_by_employee_id?: string
          store_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_returns_employee_organization_fkey"
            columns: ["returned_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_returns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_returns_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supplier_returns_supplier_organization_fkey"
            columns: ["supplier_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          lead_time_days: number
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_chain_warehouses: {
        Row: {
          code: string
          created_at: string
          created_by_employee_id: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          organization_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by_employee_id: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          organization_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by_employee_id?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          organization_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_chain_warehouses_creator_organization_fkey"
            columns: ["created_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "supply_chain_warehouses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_chain_warehouses_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          is_inclusive: boolean
          name: string
          organization_id: string
          rate_bps: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_inclusive?: boolean
          name: string
          organization_id: string
          rate_bps: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_inclusive?: boolean
          name?: string
          organization_id?: string
          rate_bps?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_templates: {
        Row: {
          created_at: string
          created_by_employee_id: string
          dining_option_id: string | null
          id: string
          is_active: boolean
          label: string
          note: string | null
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_employee_id: string
          dining_option_id?: string | null
          id?: string
          is_active?: boolean
          label: string
          note?: string | null
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_employee_id?: string
          dining_option_id?: string | null
          id?: string
          is_active?: boolean
          label?: string
          note?: string | null
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_templates_creator_organization_fkey"
            columns: ["created_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "ticket_templates_dining_option_organization_fkey"
            columns: ["dining_option_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "dining_options"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "ticket_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      time_clock_entries: {
        Row: {
          clock_in_note: string | null
          clock_in_request_id: string | null
          clock_in_verification_method: string
          clock_out_note: string | null
          clock_out_request_id: string | null
          clock_out_verification_method: string | null
          clocked_in_at: string
          clocked_in_by_employee_id: string
          clocked_out_at: string | null
          clocked_out_by_employee_id: string | null
          created_at: string
          employee_id: string
          id: string
          organization_id: string
          store_id: string
          updated_at: string
        }
        Insert: {
          clock_in_note?: string | null
          clock_in_request_id?: string | null
          clock_in_verification_method?: string
          clock_out_note?: string | null
          clock_out_request_id?: string | null
          clock_out_verification_method?: string | null
          clocked_in_at?: string
          clocked_in_by_employee_id: string
          clocked_out_at?: string | null
          clocked_out_by_employee_id?: string | null
          created_at?: string
          employee_id: string
          id?: string
          organization_id: string
          store_id: string
          updated_at?: string
        }
        Update: {
          clock_in_note?: string | null
          clock_in_request_id?: string | null
          clock_in_verification_method?: string
          clock_out_note?: string | null
          clock_out_request_id?: string | null
          clock_out_verification_method?: string | null
          clocked_in_at?: string
          clocked_in_by_employee_id?: string
          clocked_out_at?: string | null
          clocked_out_by_employee_id?: string | null
          created_at?: string
          employee_id?: string
          id?: string
          organization_id?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_clock_entries_employee_organization_fkey"
            columns: ["employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "time_clock_entries_clocked_in_by_organization_fkey"
            columns: ["clocked_in_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "time_clock_entries_clocked_out_by_organization_fkey"
            columns: ["clocked_out_by_employee_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "time_clock_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_clock_entries_store_organization_fkey"
            columns: ["store_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id", "organization_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_employee_invitation: {
        Args: { invitation_token_hash: string }
        Returns: string
      }
      add_loyalty_card_stamp: {
        Args: {
          target_idempotency_key?: string
          target_loyalty_card_id: string
          target_organization_id: string
          target_reason: string
          target_sale_id?: string
        }
        Returns: {
          card_id: string
          stamp_count: number
          stamp_target: number
          status: string
          was_replayed: boolean
        }[]
      }
      adjust_customer_loyalty_points: {
        Args: {
          target_customer_id: string
          target_organization_id: string
          target_points_delta: number
          target_reason: string
        }
        Returns: {
          loyalty_points: number
          loyalty_transaction_id: string
        }[]
      }
      adjust_inventory: {
        Args: {
          target_approval_request_id?: string
          target_movement_type: string
          target_organization_id: string
          target_product_id: string
          target_quantity_delta: number
          target_reason: string
          target_store_id: string
          target_variant_id: string
        }
        Returns: string
      }
      delete_catalog_product_if_eligible: {
        Args: {
          target_confirmation_name: string
          target_organization_id: string
          target_product_id: string
        }
        Returns: string
      }
      approve_manager_approval: {
        Args: {
          target_approval_request_id: string
          target_approver_employee_number: string
          target_organization_id: string
          target_pin: string
        }
        Returns: {
          approval_request_id: string
          approved_at: string
        }[]
      }
      approve_stock_request: {
        Args: {
          target_lines: Json
          target_organization_id: string
          target_stock_request_id: string
        }
        Returns: undefined
      }
      bootstrap_organization: {
        Args: {
          currency_code?: string
          organization_name: string
          register_name: string
          store_name: string
          timezone_name?: string
        }
        Returns: {
          organization_id: string
          register_id: string
          store_id: string
        }[]
      }
      bootstrap_organization_v2: {
        Args: {
          business_type?: string
          currency_code?: string
          organization_name: string
          register_name: string
          store_name: string
          timezone_name?: string
        }
        Returns: {
          organization_id: string
          register_id: string
          store_id: string
        }[]
      }
      change_pos_device_register: {
        Args: {
          target_device_id: string
          target_organization_id: string
          target_register_id: string
          target_store_id: string
        }
        Returns: {
          device_id: string
          last_seen_at: string
          register_id: string
          status: string
          store_id: string
        }[]
      }
      checkout_advanced_sale: {
        Args: {
          target_customer_id: string
          target_dining_option_id: string
          target_discount_id: string
          target_idempotency_key: string
          target_items: Json
          target_loyalty_redemption_points: number
          target_open_ticket_id: string
          target_organization_id: string
          target_payments: Json
          target_register_id: string
          target_store_id: string
          target_tax_rate_id: string
        }
        Returns: {
          change_minor: number
          payment_summary: Json
          receipt_number: number
          sale_id: string
          total_minor: number
          was_replayed: boolean
        }[]
      }
      checkout_cash_sale: {
        Args: {
          target_cash_tendered_minor: number
          target_idempotency_key: string
          target_items: Json
          target_organization_id: string
          target_register_id: string
          target_store_id: string
        }
        Returns: {
          cash_tendered_minor: number
          change_minor: number
          receipt_number: number
          sale_id: string
          total_minor: number
          was_replayed: boolean
        }[]
      }
      checkout_sale:
        | {
            Args: {
              target_idempotency_key: string
              target_items: Json
              target_organization_id: string
              target_payments: Json
              target_register_id: string
              target_store_id: string
            }
            Returns: {
              change_minor: number
              payment_summary: Json
              receipt_number: number
              sale_id: string
              total_minor: number
              was_replayed: boolean
            }[]
          }
        | {
            Args: {
              target_customer_id: string
              target_idempotency_key: string
              target_items: Json
              target_loyalty_redemption_points: number
              target_organization_id: string
              target_payments: Json
              target_register_id: string
              target_store_id: string
            }
            Returns: {
              change_minor: number
              payment_summary: Json
              receipt_number: number
              sale_id: string
              total_minor: number
              was_replayed: boolean
            }[]
          }
      claim_loyalty_card_reward: {
        Args: {
          target_idempotency_key?: string
          target_loyalty_card_id: string
          target_organization_id: string
          target_reason: string
          target_sale_id?: string
        }
        Returns: {
          card_id: string
          status: string
          was_replayed: boolean
        }[]
      }
      clock_in_employee: {
        Args: {
          target_clock_in_note?: string
          target_organization_id: string
          target_store_id: string
        }
        Returns: {
          clocked_in_at: string
          clocked_out_at: string
          entry_id: string
          store_id: string
          was_replayed: boolean
        }[]
      }
      clock_out_employee: {
        Args: { target_clock_out_note?: string; target_organization_id: string }
        Returns: {
          clocked_in_at: string
          clocked_out_at: string
          entry_id: string
          store_id: string
        }[]
      }
      clock_in_employee_with_pin: {
        Args: {
          target_employee_id: string
          target_organization_id: string
          target_pin: string
          target_request_id: string
          target_store_id: string
        }
        Returns: {
          clocked_in_at: string | null
          clocked_out_at: string | null
          employee_id: string
          employee_name: string
          entry_id: string | null
          message: string
          register_id: string | null
          register_name: string | null
          result_code: string
          shift_id: string | null
          shift_opened_at: string | null
          store_id: string
          store_name: string
          was_replayed: boolean
        }[]
      }
      clock_out_employee_with_pin: {
        Args: {
          target_employee_id: string
          target_organization_id: string
          target_pin: string
          target_request_id: string
        }
        Returns: {
          clocked_in_at: string | null
          clocked_out_at: string | null
          employee_id: string
          employee_name: string
          entry_id: string | null
          message: string
          register_id: string | null
          register_name: string | null
          result_code: string
          shift_id: string | null
          shift_opened_at: string | null
          store_id: string
          store_name: string
          was_replayed: boolean
        }[]
      }
      change_employee_lifecycle: {
        Args: {
          target_action: string
          target_employee_id: string
          target_organization_id: string
          target_reason: string
        }
        Returns: string
      }
      close_register_shift: {
        Args: {
          target_closing_note: string
          target_counted_cash_minor: number
          target_organization_id: string
          target_shift_id: string
        }
        Returns: {
          closed_at: string
          counted_cash_minor: number
          difference_minor: number
          expected_cash_minor: number
          shift_id: string
        }[]
      }
      complete_inventory_count: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_store_id: string
        }
        Returns: string
      }
      create_inventory_count_draft: {
        Args: {
          target_note?: string
          target_organization_id: string
          target_store_id: string
        }
        Returns: string
      }
      create_inventory_count_plan: {
        Args: {
          target_count_mode: string
          target_include_zero_stock: boolean
          target_note: string
          target_organization_id: string
          target_scope_reference_id: string | null
          target_scope_type: string
          target_selected_items: Json
          target_sort_mode: string
          target_store_id: string
        }
        Returns: string
      }
      get_inventory_count_suppliers: {
        Args: { target_organization_id: string }
        Returns: { id: string; name: string }[]
      }
      save_inventory_count_line: {
        Args: {
          target_counted_quantity: number
          target_inventory_count_id: string
          target_organization_id: string
          target_product_id: string
          target_variant_id: string | null
        }
        Returns: undefined
      }
      submit_inventory_count_for_review: {
        Args: {
          target_inventory_count_id: string
          target_organization_id: string
        }
        Returns: undefined
      }
      post_inventory_count: {
        Args: {
          target_inventory_count_id: string
          target_organization_id: string
        }
        Returns: undefined
      }
      cancel_inventory_count: {
        Args: {
          target_inventory_count_id: string
          target_note?: string
          target_organization_id: string
        }
        Returns: undefined
      }
      complete_organization_export: {
        Args: {
          target_export_session_id: string
          target_manifest: Json
          target_record_count: number
        }
        Returns: Json
      }
      create_catalog_product: {
        Args: {
          target_barcode: string
          target_category_id: string
          target_cost_minor: number
          target_description: string
          target_name: string
          target_organization_id: string
          target_price_minor: number
          target_product_type: string
          target_sku: string
          target_store_ids: string[]
          target_track_inventory: boolean
          target_unit: string
          target_variants: Json
        }
        Returns: string
      }
      create_catalog_product_v2: {
        Args: {
          target_allow_fractional_quantity: boolean
          target_barcode: string
          target_category_id: string
          target_cost_minor: number
          target_description: string
          target_image_url: string
          target_is_variable_price: boolean
          target_name: string
          target_organization_id: string
          target_price_minor: number
          target_product_type: string
          target_sku: string
          target_store_ids: string[]
          target_track_inventory: boolean
          target_unit: string
          target_variants: Json
        }
        Returns: string
      }
      update_catalog_product_v2: {
        Args: {
          target_allow_fractional_quantity: boolean
          target_barcode: string
          target_category_id: string
          target_cost_minor: number
          target_description: string
          target_image_url: string
          target_is_variable_price: boolean
          target_name: string
          target_organization_id: string
          target_price_minor: number
          target_product_id: string
          target_sku: string
          target_track_inventory: boolean
          target_unit: string
        }
        Returns: string
      }
      set_catalog_product_store_availability: {
        Args: {
          target_organization_id: string
          target_product_id: string
          target_store_ids: string[]
        }
        Returns: number
      }
      set_catalog_product_store_configuration: {
        Args: {
          target_low_stock_level: number
          target_organization_id: string
          target_price_override_minor: number
          target_product_id: string
          target_store_id: string
        }
        Returns: undefined
      }
      set_catalog_product_store_configuration_v2: {
        Args: {
          target_low_stock_level: number
          target_organization_id: string
          target_price_override_minor: number
          target_product_id: string
          target_restock_policy: string
          target_store_id: string
        }
        Returns: undefined
      }
      set_catalog_product_archived_safely: {
        Args: {
          target_is_archived: boolean
          target_organization_id: string
          target_product_id: string
        }
        Returns: string
      }
      create_custom_role: {
        Args: {
          permission_codes: string[]
          role_code: string
          role_description: string
          role_name: string
          target_organization_id: string
        }
        Returns: string
      }
      create_customer_segment: {
        Args: {
          target_description?: string
          target_name: string
          target_organization_id: string
        }
        Returns: string
      }
      create_inventory_adjustment_reason: {
        Args: {
          target_code: string
          target_movement_type: string
          target_name: string
          target_organization_id: string
        }
        Returns: string
      }
      create_purchase_order: {
        Args: {
          target_expected_at: string
          target_lines: Json
          target_notes: string
          target_organization_id: string
          target_store_id: string
          target_supplier_id: string
        }
        Returns: string
      }
      create_stock_request: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_requesting_store_id: string
          target_source_warehouse_id: string
        }
        Returns: string
      }
      create_store_scoped_payment_method: {
        Args: {
          target_code: string
          target_name: string
          target_organization_id: string
          target_payment_type: string
          target_requires_reference: boolean
          target_store_ids: string[]
        }
        Returns: string
      }
      create_supplier: {
        Args: {
          target_address: string
          target_contact_name: string
          target_email: string
          target_name: string
          target_notes: string
          target_organization_id: string
          target_phone: string
        }
        Returns: string
      }
      create_supply_chain_warehouse: {
        Args: {
          target_code: string
          target_name: string
          target_notes: string
          target_organization_id: string
          target_store_id: string
        }
        Returns: string
      }
      delete_unused_setup_record: {
        Args: {
          target_confirmation_name: string
          target_organization_id: string
          target_record_id: string
          target_record_type: string
        }
        Returns: string
      }
      dispatch_stock_request: {
        Args: {
          target_note: string
          target_organization_id: string
          target_stock_request_id: string
        }
        Returns: string
      }
      generate_catalog_identifiers: {
        Args: { target_organization_id: string; target_product_name: string }
        Returns: {
          barcode: string
          sku: string
        }[]
      }
      get_catalog_costs: {
        Args: {
          requested_product_ids?: string[]
          target_organization_id: string
        }
        Returns: {
          cost_minor: number
          product_id: string
          variant_id: string
        }[]
      }
      get_checkout_stock_warning: {
        Args: {
          target_organization_id: string
          target_sale_id: string
          target_store_id: string
        }
        Returns: number
      }
      get_current_time_clock_entry: {
        Args: { target_organization_id: string }
        Returns: {
          clocked_in_at: string
          entry_id: string
          store_id: string
        }[]
      }
      get_attendance_employees: {
        Args: { target_organization_id: string; target_store_id: string }
        Returns: {
          clocked_in_at: string | null
          employee_id: string
          employee_name: string
          employee_number: string
          entry_id: string | null
          entry_store_id: string | null
          entry_store_name: string | null
          pin_is_set: boolean
        }[]
      }
      get_employee_management_detail: {
        Args: { target_employee_id: string; target_organization_id: string }
        Returns: Json
      }
      get_customer_display_bootstrap: {
        Args: { target_access_token_hash: string }
        Returns: Json
      }
      get_customer_display_management_sessions: {
        Args: { target_organization_id: string }
        Returns: {
          created_at: string
          last_published_at: string
          register_id: string
        }[]
      }
      get_customer_display_receipt: {
        Args: { target_access_token_hash: string; target_sale_id: string }
        Returns: Json
      }
      get_customer_loyalty_card_events: {
        Args: { target_customer_id: string; target_organization_id: string }
        Returns: {
          card_code: string
          created_at: string
          event_id: string
          event_type: string
          loyalty_card_id: string
          reason: string
          sale_id: string
          stamp_count_after: number
          stamp_count_before: number
          stamp_delta: number
        }[]
      }
      get_customer_loyalty_cards: {
        Args: { target_customer_id: string; target_organization_id: string }
        Returns: {
          card_code: string
          card_id: string
          deactivated_at: string
          deactivation_reason: string
          expires_at: string
          issued_at: string
          stamp_count: number
          stamp_target: number
          status: string
        }[]
      }
      get_customer_purchase_history: {
        Args: {
          target_customer_id: string
          target_limit: number
          target_organization_id: string
        }
        Returns: {
          completed_at: string
          currency_code: string
          loyalty_points_earned: number
          loyalty_points_redeemed: number
          receipt_number: number
          sale_id: string
          store_name: string
          total_minor: number
        }[]
      }
      get_customer_summary: {
        Args: { target_customer_id: string; target_organization_id: string }
        Returns: {
          average_sale_minor: number
          customer_id: string
          full_name: string
          last_purchase_at: string
          lifetime_spend_minor: number
          loyalty_points: number
          sale_count: number
          status: string
        }[]
      }
      get_dashboard_snapshot: {
        Args: {
          target_end_date: string
          target_organization_id: string
          target_start_date: string
          target_store_id?: string
        }
        Returns: Json
      }
      get_inventory_valuation: {
        Args: { target_organization_id: string }
        Returns: {
          average_cost_minor: number
          product_id: string
          quantity: number
          store_id: string
          value_minor: number
          variant_id: string
        }[]
      }
      get_inventory_movement_costs: {
        Args: {
          requested_movement_ids: string[]
          target_organization_id: string
        }
        Returns: {
          id: string
          unit_cost_minor: number
          value_delta_minor: number
        }[]
      }
      get_kitchen_orders: {
        Args: { target_organization_id: string; target_store_id?: string }
        Returns: {
          completed_at: string
          created_at: string
          dining_option_name: string
          items: Json
          kitchen_order_id: string
          order_label: string
          order_note: string
          order_number: number
          priority: string
          ready_at: string
          started_at: string
          status: string
          store_id: string
          store_name: string
        }[]
      }
      get_kitchen_station_routes: {
        Args: { target_organization_id: string }
        Returns: {
          category_id: string
          category_name: string
          station: string
        }[]
      }
      get_organization_export_page: {
        Args: {
          target_after_id?: string
          target_export_session_id: string
          target_section: string
        }
        Returns: Json
      }
      get_organization_readiness_access: {
        Args: { target_organization_id: string }
        Returns: Json
      }
      get_organization_recovery_snapshot: {
        Args: { target_organization_id: string }
        Returns: Json
      }
      get_organization_usage_snapshot: {
        Args: { target_organization_id: string }
        Returns: Json
      }
      get_purchase_order_line_costs: {
        Args: {
          requested_purchase_order_line_ids: string[]
          target_organization_id: string
        }
        Returns: {
          id: string
          unit_cost_minor: number
        }[]
      }
      get_pos_customer_display_sessions: {
        Args: { target_organization_id: string }
        Returns: {
          realtime_topic: string
          register_id: string
        }[]
      }
      get_pos_customer_display_sessions_with_ids: {
        Args: { target_organization_id: string }
        Returns: {
          realtime_topic: string
          register_id: string
          session_id: string
        }[]
      }
      get_pos_favorite_items: {
        Args: { target_organization_id: string; target_store_id: string }
        Returns: {
          allow_fractional_quantity: boolean
          barcode: string
          category_id: string
          image_url: string
          is_variable_price: boolean
          price_minor: number
          product_id: string
          product_name: string
          sku: string
          unit: string
          variant_id: string
          variant_name: string
        }[]
      }
      get_pos_open_tickets: {
        Args: {
          target_organization_id: string
          target_register_id: string
          target_store_id: string
        }
        Returns: {
          assigned_employee_id: string
          cart: Json
          customer_email: string
          customer_full_name: string
          customer_id: string
          customer_loyalty_points: number
          customer_number: number
          customer_phone: string
          dining_option_id: string
          label: string
          loyalty_card_code: string
          note: string
          ticket_id: string
          updated_at: string
        }[]
      }
      get_pos_product_modifiers:
        | {
            Args: { target_organization_id: string; target_product_id: string }
            Returns: {
              group_id: string
              group_name: string
              max_selections: number
              min_selections: number
              options: Json
            }[]
          }
        | {
            Args: {
              target_organization_id: string
              target_product_id: string
              target_store_id: string
            }
            Returns: {
              group_id: string
              group_name: string
              max_selections: number
              min_selections: number
              options: Json
            }[]
          }
      get_pos_recent_items: {
        Args: {
          target_limit?: number
          target_organization_id: string
          target_store_id: string
        }
        Returns: {
          allow_fractional_quantity: boolean
          barcode: string
          category_id: string
          image_url: string
          is_variable_price: boolean
          price_minor: number
          product_id: string
          product_name: string
          sku: string
          unit: string
          variant_id: string
          variant_name: string
        }[]
      }
      get_pos_ticket_assignees: {
        Args: { target_organization_id: string; target_store_id: string }
        Returns: {
          employee_id: string
          full_name: string
        }[]
      }
      get_public_smart_menu: { Args: { target_menu_id: string }; Returns: Json }
      get_reports_snapshot: {
        Args: {
          target_end_date: string
          target_organization_id: string
          target_start_date: string
          target_store_id?: string
        }
        Returns: Json
      }
      get_shift_cash_summary: {
        Args: { target_organization_id: string; target_shift_id: string }
        Returns: {
          cash_refunds_minor: number
          cash_sales_minor: number
          expected_cash_minor: number
          opening_cash_minor: number
          pay_ins_minor: number
          pay_outs_minor: number
          shift_id: string
          status: string
        }[]
      }
      import_catalog_products_v2: {
        Args: {
          target_organization_id: string
          target_rows: Json
          target_store_ids: string[]
        }
        Returns: number
      }
      import_customers_csv: {
        Args: { target_organization_id: string; target_rows: Json }
        Returns: number
      }
      import_inventory_adjustments_csv: {
        Args: {
          target_organization_id: string
          target_reason_code: string
          target_rows: Json
          target_store_id: string
        }
        Returns: number
      }
      import_suppliers_csv: {
        Args: { target_organization_id: string; target_rows: Json }
        Returns: number
      }
      issue_loyalty_card: {
        Args: {
          target_card_code: string
          target_customer_id: string
          target_organization_id: string
          target_reason?: string
          target_replaces_card_id?: string
          target_verification_token: string
        }
        Returns: {
          card_code: string
          card_id: string
          stamp_count: number
          stamp_target: number
          status: string
        }[]
      }
      link_sale_exchange: {
        Args: {
          target_idempotency_key: string
          target_organization_id: string
          target_refund_id: string
          target_replacement_receipt_number: number
        }
        Returns: {
          exchange_id: string
          replacement_receipt_number: number
          replacement_sale_id: string
          was_replayed: boolean
        }[]
      }
      manage_organization_lifecycle: {
        Args: {
          target_action: string
          target_organization_id: string
          target_reason?: string
        }
        Returns: Json
      }
      merge_open_tickets: {
        Args: {
          target_destination_ticket_id: string
          target_organization_id: string
          target_source_ticket_id: string
        }
        Returns: undefined
      }
      move_open_ticket_lines: {
        Args: {
          target_destination_ticket_id: string
          target_lines: Json
          target_organization_id: string
          target_source_ticket_id: string
        }
        Returns: undefined
      }
      open_register_shift: {
        Args: {
          target_opening_cash_minor: number
          target_opening_note: string
          target_organization_id: string
          target_register_id: string
          target_store_id: string
        }
        Returns: {
          opened_at: string
          shift_id: string
          was_replayed: boolean
        }[]
      }
      prepare_organization_export: {
        Args: { target_organization_id: string }
        Returns: Json
      }
      produce_composite: {
        Args: {
          target_note: string
          target_organization_id: string
          target_product_id: string
          target_quantity: number
          target_store_id: string
        }
        Returns: string
      }
      provision_customer_display_session: {
        Args: {
          target_access_token_hash: string
          target_organization_id: string
          target_realtime_topic: string
          target_register_id: string
        }
        Returns: {
          session_id: string
        }[]
      }
      queue_receipt_delivery: {
        Args: {
          target_delivery_channel: string
          target_idempotency_key: string
          target_organization_id: string
          target_receipt_id: string
          target_recipient: string
        }
        Returns: {
          delivery_request_id: string
          delivery_status: string
          was_replayed: boolean
        }[]
      }
      receive_purchase_order: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_purchase_order_id: string
        }
        Returns: string
      }
      receive_stock_request: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_stock_request_id: string
        }
        Returns: string
      }
      receive_stock_transfer: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_stock_transfer_id: string
        }
        Returns: string
      }
      record_cash_movement: {
        Args: {
          target_amount_minor: number
          target_approval_request_id?: string
          target_idempotency_key: string
          target_movement_type: string
          target_organization_id: string
          target_reason: string
          target_shift_id: string
        }
        Returns: {
          cash_movement_id: string
          created_at: string
          was_replayed: boolean
        }[]
      }
      record_inventory_adjustment_v2: {
        Args: {
          target_note: string
          target_organization_id: string
          target_product_id: string
          target_quantity_delta: number
          target_reason_code: string
          target_store_id: string
          target_variant_id: string
        }
        Returns: string
      }
      record_offline_sync_event: {
        Args: {
          target_conflict_type: string
          target_device_id: string
          target_failure_message: string
          target_idempotency_key: string
          target_local_created_at: string
          target_local_receipt_reference: string
          target_official_receipt_number?: number
          target_organization_id: string
          target_register_id: string
          target_shift_id: string
          target_state: string
          target_store_id: string
        }
        Returns: string
      }
      record_organization_recovery_drill: {
        Args: {
          target_drill_type: string
          target_duration_minutes: number
          target_notes: string
          target_organization_id: string
          target_outcome: string
          target_recovery_point_at: string
        }
        Returns: Json
      }
      refund_sale: {
        Args: {
          target_approval_request_id?: string
          target_idempotency_key: string
          target_items: Json
          target_organization_id: string
          target_payment_method_id: string
          target_reason: string
          target_reference_number: string
          target_sale_id: string
        }
        Returns: {
          refund_id: string
          refund_number: number
          total_minor: number
          was_replayed: boolean
        }[]
      }
      register_pos_device: {
        Args: {
          target_app_version: string
          target_device_id: string
          target_name: string
          target_organization_id: string
          target_register_id: string
          target_secret: string
          target_store_id: string
        }
        Returns: {
          device_id: string
          last_seen_at: string
          register_id: string
          status: string
          store_id: string
        }[]
      }
      request_manager_approval: {
        Args: {
          target_operation_code: string
          target_organization_id: string
          target_payload: Json
          target_reason: string
        }
        Returns: {
          approval_request_id: string
          decision: string
          expires_at: string
          message: string
        }[]
      }
      restore_tindio_payment_preset: {
        Args: {
          target_organization_id: string
          target_preset_code: string
          target_store_ids: string[]
        }
        Returns: string
      }
      return_to_supplier: {
        Args: {
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_store_id: string
          target_supplier_id: string
        }
        Returns: string
      }
      revoke_loyalty_card: {
        Args: {
          target_loyalty_card_id: string
          target_organization_id: string
          target_reason: string
        }
        Returns: undefined
      }
      revoke_pos_device: {
        Args: {
          target_device_id: string
          target_organization_id: string
          target_reason?: string
        }
        Returns: {
          device_id: string
          revoked_at: string
          status: string
        }[]
      }
      rotate_loyalty_card_qr: {
        Args: {
          target_loyalty_card_id: string
          target_organization_id: string
          target_reason: string
          target_verification_token: string
        }
        Returns: {
          card_code: string
          card_id: string
        }[]
      }
      save_open_ticket_v2: {
        Args: {
          target_assigned_employee_id: string
          target_cart: Json
          target_customer_id: string
          target_dining_option_id: string
          target_label: string
          target_note: string
          target_organization_id: string
          target_register_id: string
          target_store_id: string
          target_ticket_id: string
        }
        Returns: {
          created_at: string
          ticket_id: string
          updated_at: string
        }[]
      }
      save_smart_menu_configuration: {
        Args: {
          target_category_ids: string[]
          target_is_enabled: boolean
          target_product_ids: string[]
          target_show_images: boolean
          target_show_modifiers: boolean
          target_show_prices: boolean
          target_show_unavailable: boolean
          target_show_variants: boolean
          target_store_id: string
        }
        Returns: string
      }
      search_pos_catalog: {
        Args: {
          target_category_id?: string
          target_limit?: number
          target_offset?: number
          target_organization_id: string
          target_query?: string
          target_store_id: string
        }
        Returns: {
          allow_fractional_quantity: boolean
          barcode: string
          category_id: string
          image_url: string
          is_variable_price: boolean
          price_minor: number
          product_id: string
          product_name: string
          sku: string
          unit: string
          variant_id: string
          variant_name: string
        }[]
      }
      search_pos_customers: {
        Args: {
          target_limit: number
          target_organization_id: string
          target_query: string
          target_store_id: string
        }
        Returns: {
          customer_id: string
          customer_number: number
          email: string
          full_name: string
          loyalty_card_code: string
          loyalty_points: number
          phone: string
        }[]
      }
      set_customer_display_state: {
        Args: {
          target_organization_id: string
          target_session_id: string
          target_state: Json
        }
        Returns: undefined
      }
      set_employee_pin: {
        Args: {
          target_employee_id: string
          target_organization_id: string
          target_pin: string
        }
        Returns: undefined
      }
      set_kitchen_order_priority: {
        Args: {
          target_kitchen_order_id: string
          target_organization_id: string
          target_priority: string
        }
        Returns: {
          priority: string
        }[]
      }
      set_kitchen_station_category_route: {
        Args: {
          target_category_id: string
          target_organization_id: string
          target_station: string
        }
        Returns: {
          category_id: string
          station: string
        }[]
      }
      set_payment_method_offline_policy: {
        Args: {
          target_offline_policy: string
          target_organization_id: string
          target_payment_method_id: string
        }
        Returns: boolean
      }
      set_pos_favorite_tile: {
        Args: {
          target_is_favorite: boolean
          target_organization_id: string
          target_product_id: string
          target_store_id: string
          target_variant_id: string
        }
        Returns: boolean
      }
      set_store_payment_method_configuration: {
        Args: {
          target_is_enabled: boolean
          target_organization_id: string
          target_payment_method_id: string
          target_store_id: string
        }
        Returns: boolean
      }
      ship_stock_transfer: {
        Args: {
          target_destination_store_id: string
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_source_store_id: string
        }
        Returns: string
      }
      split_open_ticket: {
        Args: {
          target_label: string
          target_lines: Json
          target_organization_id: string
          target_source_ticket_id: string
        }
        Returns: string
      }
      start_stock_request_picking: {
        Args: {
          target_organization_id: string
          target_stock_request_id: string
        }
        Returns: undefined
      }
      transfer_stock: {
        Args: {
          target_destination_store_id: string
          target_lines: Json
          target_note: string
          target_organization_id: string
          target_source_store_id: string
        }
        Returns: string
      }
      validate_pos_cart_stock: {
        Args: {
          target_items: Json
          target_organization_id: string
          target_register_id: string
          target_store_id: string
        }
        Returns: Json
      }
      update_approval_rule: {
        Args: {
          target_amount_threshold_minor: number
          target_decision: string
          target_is_enabled: boolean
          target_operation_code: string
          target_organization_id: string
        }
        Returns: undefined
      }
      update_business_profile_features: {
        Args: {
          target_business_type: string
          target_feature_settings: Json
          target_organization_id: string
        }
        Returns: Json
      }
      update_custom_role: {
        Args: {
          permission_codes: string[]
          role_description: string
          role_name: string
          target_organization_id: string
          target_role_id: string
        }
        Returns: string
      }
      update_customer_profile: {
        Args: {
          target_address: string
          target_birthday: string
          target_customer_id: string
          target_email: string
          target_full_name: string
          target_loyalty_card_code: string
          target_notes: string
          target_organization_id: string
          target_phone: string
          target_segment_ids?: string[]
        }
        Returns: undefined
      }
      update_employee_assignments: {
        Args: {
          target_employee_id: string
          target_job_title: string
          target_organization_id: string
          target_role_ids: string[]
          target_status: string
          target_store_ids: string[]
        }
        Returns: string
      }
      update_employee_profile: {
        Args: {
          target_employee_id: string
          target_full_name: string
          target_organization_id: string
          target_phone: string
        }
        Returns: undefined
      }
      delete_employee_if_eligible: {
        Args: {
          target_confirmation_number: string
          target_employee_id: string
          target_organization_id: string
        }
        Returns: string
      }
      update_inventory_policy: {
        Args: {
          target_negative_stock_policy: string
          target_organization_id: string
          target_store_id: string
        }
        Returns: undefined
      }
      update_kitchen_order_item_status: {
        Args: {
          target_kitchen_order_item_id: string
          target_organization_id: string
          target_status: string
        }
        Returns: {
          item_status: string
          order_status: string
        }[]
      }
      update_kitchen_order_status: {
        Args: {
          target_kitchen_order_id: string
          target_organization_id: string
          target_status: string
        }
        Returns: {
          status: string
        }[]
      }
      update_payment_method_configuration: {
        Args: {
          target_is_enabled: boolean
          target_name: string
          target_organization_id: string
          target_payment_method_id: string
          target_requires_reference: boolean
          target_sort_order: number
        }
        Returns: boolean
      }
      update_receipt_delivery_status: {
        Args: {
          target_delivery_request_id: string
          target_failure_reason?: string
          target_provider_message_id?: string
          target_status: string
        }
        Returns: boolean
      }
      update_receipt_settings: {
        Args: {
          target_business_address: string
          target_business_email: string
          target_business_name: string
          target_business_phone: string
          target_business_tax_id: string
          target_business_website: string
          target_footer_message: string
          target_header_message: string
          target_organization_id: string
          target_paper_width_mm: number
          target_show_cashier: boolean
          target_show_payment_details: boolean
          target_show_register: boolean
          target_show_store_address: boolean
          target_show_store_phone: boolean
        }
        Returns: boolean
      }
      update_shift_cash_close_setting: {
        Args: {
          target_organization_id: string
          target_show_expected_cash_before_close: boolean
        }
        Returns: boolean
      }
      update_supplier: {
        Args: {
          target_address: string
          target_contact_name: string
          target_email: string
          target_is_active: boolean
          target_name: string
          target_notes: string
          target_organization_id: string
          target_phone: string
          target_supplier_id: string
        }
        Returns: string
      }
      update_supplier_lead_time: {
        Args: {
          target_lead_time_days: number
          target_organization_id: string
          target_supplier_id: string
        }
        Returns: undefined
      }
      upsert_inventory_replenishment_rule: {
        Args: {
          target_organization_id: string
          target_preferred_warehouse_id: string
          target_product_id: string
          target_reorder_point: number
          target_store_id: string
          target_target_stock: number
          target_variant_id: string
        }
        Returns: string
      }
      validate_pos_device: {
        Args: {
          target_app_version: string
          target_device_id: string
          target_organization_id: string
          target_secret: string
        }
        Returns: {
          app_version: string
          device_id: string
          device_name: string
          last_seen_at: string
          register_id: string
          store_id: string
        }[]
      }
      verify_loyalty_card_qr: {
        Args: {
          target_loyalty_card_id: string
          target_verification_token: string
        }
        Returns: {
          card_code: string
          expires_at: string
          stamp_count: number
          stamp_target: number
          verification_status: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

// Application convenience alias retained across Supabase CLI type regeneration.
export type TableRow<TableName extends keyof DefaultSchema["Tables"]> = Tables<TableName>;
