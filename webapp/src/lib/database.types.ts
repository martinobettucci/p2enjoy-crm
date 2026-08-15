// @spec CRM-006 (docs/BACKLOG.md) — types TypeScript dérivés du schéma
// @spec docs/SPEC-types.md §3 (source), §5 (fichier), §6 (garde anti-dérive)
// @spec docs/SCHEMA.md §1 (socle d'identité) ; docs/DAT.md §3.1 (webapp)
//
// FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Régénérer : npm run types:generate    Vérifier : npm run types:check
//
// Source : le schéma de la base de développement réellement migrée, lu par
// supabase/postgres-meta. Une contrainte CHECK ne survit pas à la génération : le vocabulaire
// des rôles et des accès n'est tenu que par la base (docs/SPEC-types.md §7).

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      card_comments: {
        Row: {
          author_id: string | null
          body: string
          card_id: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: string
          mentions: string[]
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          card_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[]
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          card_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          mentions?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_comments_card_id_workspace_id_fkey"
            columns: ["card_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "card_comments_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      card_events: {
        Row: {
          actor_id: string | null
          card_id: string
          created_at: string
          id: string
          payload: Json
          type: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          card_id: string
          created_at?: string
          id?: string
          payload?: Json
          type: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          card_id?: string
          created_at?: string
          id?: string
          payload?: Json
          type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_events_card_id_workspace_id_fkey"
            columns: ["card_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      card_field_values: {
        Row: {
          card_id: string
          created_at: string
          field_id: string
          updated_at: string
          updated_by: string | null
          value: Json | null
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          card_id: string
          created_at?: string
          field_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
          workflow_id: string
          workspace_id: string
        }
        Update: {
          card_id?: string
          created_at?: string
          field_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "card_field_values_card_id_workflow_id_fkey"
            columns: ["card_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "card_field_values_field_id_workflow_id_fkey"
            columns: ["field_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "card_field_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_field_values_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "card_field_values_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "card_field_values_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      cards: {
        Row: {
          amount: number | null
          archived_at: string | null
          channel_id: string
          created_at: string
          created_by: string | null
          currency: string
          current_step_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          email_local_part: string
          entered_step_at: string
          health_score: number | null
          id: string
          next_action: string | null
          next_action_at: string | null
          owner_id: string | null
          position: number
          probability_override: number | null
          search_tsv: unknown
          snoozed_until: string | null
          title: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          archived_at?: string | null
          channel_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_step_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          email_local_part: string
          entered_step_at?: string
          health_score?: number | null
          id?: string
          next_action?: string | null
          next_action_at?: string | null
          owner_id?: string | null
          position: number
          probability_override?: number | null
          search_tsv?: unknown
          snoozed_until?: string | null
          title: string
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          amount?: number | null
          archived_at?: string | null
          channel_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          current_step_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          email_local_part?: string
          entered_step_at?: string
          health_score?: number | null
          id?: string
          next_action?: string | null
          next_action_at?: string | null
          owner_id?: string | null
          position?: number
          probability_override?: number | null
          search_tsv?: unknown
          snoozed_until?: string | null
          title?: string
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_channel_id_workflow_id_fkey"
            columns: ["channel_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "cards_channel_id_workspace_id_fkey"
            columns: ["channel_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_current_step_id_workflow_id_fkey"
            columns: ["current_step_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "cards_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_members: {
        Row: {
          access: string
          channel_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          access: string
          channel_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          access?: string
          channel_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          id: string
          name: string
          position: number
          slug: string
          track_id: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name: string
          position: number
          slug: string
          track_id: string
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          id?: string
          name?: string
          position?: number
          slug?: string
          track_id?: string
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_track_id_workspace_id_fkey"
            columns: ["track_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "channels_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "channels_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "channels_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      form_field_rules: {
        Row: {
          created_at: string
          field_id: string
          step_id: string
          updated_at: string
          visibility: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          field_id: string
          step_id: string
          updated_at?: string
          visibility: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          field_id?: string
          step_id?: string
          updated_at?: string
          visibility?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_field_rules_field_id_workflow_id_fkey"
            columns: ["field_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "form_field_rules_step_id_workflow_id_fkey"
            columns: ["step_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "form_field_rules_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "form_field_rules_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "form_field_rules_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      form_fields: {
        Row: {
          archived_at: string | null
          created_at: string
          help_text: string | null
          id: string
          key: string
          label: string
          options: Json
          position: number
          type: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          help_text?: string | null
          id?: string
          key: string
          label: string
          options?: Json
          position: number
          type: string
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          help_text?: string | null
          id?: string
          key?: string
          label?: string
          options?: Json
          position?: number
          type?: string
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "form_fields_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "form_fields_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      mail_attachments: {
        Row: {
          av_checked_at: string | null
          av_status: string
          card_id: string | null
          created_at: string
          filename: string
          id: string
          message_id: string
          mime_type: string
          original_name: string | null
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          av_checked_at?: string | null
          av_status?: string
          card_id?: string | null
          created_at?: string
          filename: string
          id?: string
          message_id: string
          mime_type: string
          original_name?: string | null
          sha256: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          av_checked_at?: string | null
          av_status?: string
          card_id?: string | null
          created_at?: string
          filename?: string
          id?: string
          message_id?: string
          mime_type?: string
          original_name?: string | null
          sha256?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_attachments_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_folder_map: {
        Row: {
          account_id: string
          actual_path: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          requested_path: string
          updated_at: string
        }
        Insert: {
          account_id: string
          actual_path: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          requested_path: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          actual_path?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          requested_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_folder_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "mail_inbound_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_inbound_accounts: {
        Row: {
          backfill_months: number
          created_at: string
          folder_style: string
          id: string
          imap_host: string
          imap_port: number
          imap_security: string
          imap_username: string
          label: string
          last_checked_at: string | null
          last_error: string | null
          last_sync_at: string | null
          owner_id: string | null
          secret_id: string | null
          status: string
          sync_state: Json
          updated_at: string
          watch_folders: string[]
          workspace_id: string
        }
        Insert: {
          backfill_months?: number
          created_at?: string
          folder_style?: string
          id?: string
          imap_host: string
          imap_port: number
          imap_security?: string
          imap_username: string
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          owner_id?: string | null
          secret_id?: string | null
          status?: string
          sync_state?: Json
          updated_at?: string
          watch_folders?: string[]
          workspace_id: string
        }
        Update: {
          backfill_months?: number
          created_at?: string
          folder_style?: string
          id?: string
          imap_host?: string
          imap_port?: number
          imap_security?: string
          imap_username?: string
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          owner_id?: string | null
          secret_id?: string | null
          status?: string
          sync_state?: Json
          updated_at?: string
          watch_folders?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_inbound_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_inbound_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_message_occurrences: {
        Row: {
          account_id: string
          flags: string[]
          folder: string
          message_id: string
          seen_at: string
          uid: number
        }
        Insert: {
          account_id: string
          flags?: string[]
          folder: string
          message_id: string
          seen_at?: string
          uid: number
        }
        Update: {
          account_id?: string
          flags?: string[]
          folder?: string
          message_id?: string
          seen_at?: string
          uid?: number
        }
        Relationships: [
          {
            foreignKeyName: "mail_message_occurrences_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "mail_inbound_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_message_occurrences_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_messages: {
        Row: {
          body_html: string | null
          body_text: string | null
          card_id: string | null
          cc_addresses: string[]
          classification: string
          classified_at: string | null
          classified_by: string | null
          created_at: string
          direction: string
          filed_at: string | null
          from_address: string
          from_name: string | null
          id: string
          received_at: string
          references_ids: string[]
          rfc822_message_id: string
          sent_at: string | null
          subject: string | null
          to_addresses: string[]
          workspace_id: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          card_id?: string | null
          cc_addresses?: string[]
          classification?: string
          classified_at?: string | null
          classified_by?: string | null
          created_at?: string
          direction?: string
          filed_at?: string | null
          from_address: string
          from_name?: string | null
          id?: string
          received_at?: string
          references_ids?: string[]
          rfc822_message_id: string
          sent_at?: string | null
          subject?: string | null
          to_addresses?: string[]
          workspace_id: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          card_id?: string | null
          cc_addresses?: string[]
          classification?: string
          classified_at?: string | null
          classified_by?: string | null
          created_at?: string
          direction?: string
          filed_at?: string | null
          from_address?: string
          from_name?: string | null
          id?: string
          received_at?: string
          references_ids?: string[]
          rfc822_message_id?: string
          sent_at?: string | null
          subject?: string | null
          to_addresses?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_messages_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_classified_by_fkey"
            columns: ["classified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_outbound_identities: {
        Row: {
          created_at: string
          daily_quota: number | null
          from_address: string
          from_name: string | null
          id: string
          is_default: boolean
          label: string
          last_checked_at: string | null
          last_error: string | null
          owner_id: string | null
          secret_id: string | null
          signature_html: string | null
          smtp_host: string
          smtp_port: number
          smtp_security: string
          smtp_username: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          daily_quota?: number | null
          from_address: string
          from_name?: string | null
          id?: string
          is_default?: boolean
          label: string
          last_checked_at?: string | null
          last_error?: string | null
          owner_id?: string | null
          secret_id?: string | null
          signature_html?: string | null
          smtp_host: string
          smtp_port: number
          smtp_security?: string
          smtp_username: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          daily_quota?: number | null
          from_address?: string
          from_name?: string | null
          id?: string
          is_default?: boolean
          label?: string
          last_checked_at?: string | null
          last_error?: string | null
          owner_id?: string | null
          secret_id?: string | null
          signature_html?: string | null
          smtp_host?: string
          smtp_port?: number
          smtp_security?: string
          smtp_username?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_outbound_identities_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbound_identities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_outbox: {
        Row: {
          attachments: Json
          attempts: number
          body_text: string
          card_id: string
          cc_addrs: string[]
          created_at: string
          created_by: string | null
          id: string
          identity_id: string
          in_reply_to_message_id: string | null
          last_error: string | null
          next_attempt_at: string
          reserved_at: string | null
          rfc822_message_id: string | null
          sent_at: string | null
          sent_message_id: string | null
          status: string
          subject: string | null
          to_addrs: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attachments?: Json
          attempts?: number
          body_text: string
          card_id: string
          cc_addrs?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          identity_id: string
          in_reply_to_message_id?: string | null
          last_error?: string | null
          next_attempt_at?: string
          reserved_at?: string | null
          rfc822_message_id?: string | null
          sent_at?: string | null
          sent_message_id?: string | null
          status?: string
          subject?: string | null
          to_addrs: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attachments?: Json
          attempts?: number
          body_text?: string
          card_id?: string
          cc_addrs?: string[]
          created_at?: string
          created_by?: string | null
          id?: string
          identity_id?: string
          in_reply_to_message_id?: string | null
          last_error?: string | null
          next_attempt_at?: string
          reserved_at?: string | null
          rfc822_message_id?: string | null
          sent_at?: string | null
          sent_message_id?: string | null
          status?: string
          subject?: string | null
          to_addrs?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_outbox_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "mail_outbound_identities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_in_reply_to_message_id_fkey"
            columns: ["in_reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_sent_message_id_fkey"
            columns: ["sent_message_id"]
            isOneToOne: false
            referencedRelation: "mail_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_outbox_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          locale: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          locale?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          locale?: string
          updated_at?: string
        }
        Relationships: []
      }
      track_members: {
        Row: {
          access: string
          created_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          access: string
          created_at?: string
          track_id: string
          user_id: string
        }
        Update: {
          access?: string
          created_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_members_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          icon: string
          id: string
          name: string
          position: number
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          icon?: string
          id?: string
          name: string
          position: number
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          icon?: string
          id?: string
          name?: string
          position?: number
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tracks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_nodes_catalog: {
        Row: {
          archived_at: string | null
          color: string
          created_at: string
          default_probability: number | null
          default_stale_after_days: number | null
          id: string
          key: string
          kind: string
          label: string
          position: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          color?: string
          created_at?: string
          default_probability?: number | null
          default_stale_after_days?: number | null
          id?: string
          key: string
          kind?: string
          label: string
          position: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          color?: string
          created_at?: string
          default_probability?: number | null
          default_stale_after_days?: number | null
          id?: string
          key?: string
          kind?: string
          label?: string
          position?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_nodes_catalog_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_steps: {
        Row: {
          created_at: string
          id: string
          is_initial: boolean
          label_override: string | null
          node_id: string
          position: number
          probability_override: number | null
          stale_after_days: number | null
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_initial?: boolean
          label_override?: string | null
          node_id: string
          position: number
          probability_override?: number | null
          stale_after_days?: number | null
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_initial?: boolean
          label_override?: string | null
          node_id?: string
          position?: number
          probability_override?: number | null
          stale_after_days?: number | null
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_steps_node_id_workspace_id_fkey"
            columns: ["node_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_nodes_catalog"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_steps_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_steps_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_steps_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      workflow_transition_required_fields: {
        Row: {
          field_id: string
          transition_id: string
        }
        Insert: {
          field_id: string
          transition_id: string
        }
        Update: {
          field_id?: string
          transition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_transition_required_fields_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "form_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_transition_required_fields_transition_id_fkey"
            columns: ["transition_id"]
            isOneToOne: false
            referencedRelation: "workflow_transitions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_transitions: {
        Row: {
          created_at: string
          from_step_id: string
          id: string
          label: string | null
          require_comment: boolean
          to_step_id: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          from_step_id: string
          id?: string
          label?: string | null
          require_comment?: boolean
          to_step_id: string
          updated_at?: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          from_step_id?: string
          id?: string
          label?: string | null
          require_comment?: boolean
          to_step_id?: string
          updated_at?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_transitions_from_step_fkey"
            columns: ["from_step_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "workflow_transitions_to_step_fkey"
            columns: ["to_step_id", "workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_steps"
            referencedColumns: ["id", "workflow_id"]
          },
          {
            foreignKeyName: "workflow_transitions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_transitions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_transitions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          composition: Json
          composition_fingerprint: string
          id: string
          note: string | null
          published_at: string
          published_by: string | null
          version_number: number
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          composition: Json
          composition_fingerprint: string
          id?: string
          note?: string | null
          published_at?: string
          published_by?: string | null
          version_number: number
          workflow_id: string
          workspace_id: string
        }
        Update: {
          composition?: Json
          composition_fingerprint?: string
          id?: string
          note?: string | null
          published_at?: string
          published_by?: string | null
          version_number?: number
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_versions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_versions_workflow_id_workspace_id_fkey"
            columns: ["workflow_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workflow_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          archived_at: string | null
          created_at: string
          derived_at: string | null
          derived_from_workflow_id: string | null
          id: string
          is_default: boolean
          name: string
          scope: string
          source_composition_fingerprint: string | null
          track_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          derived_at?: string | null
          derived_from_workflow_id?: string | null
          id?: string
          is_default?: boolean
          name: string
          scope?: string
          source_composition_fingerprint?: string | null
          track_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          derived_at?: string | null
          derived_from_workflow_id?: string | null
          id?: string
          is_default?: boolean
          name?: string
          scope?: string
          source_composition_fingerprint?: string | null
          track_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_derived_from_workflow_id_fkey"
            columns: ["derived_from_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["source_workflow_id"]
          },
          {
            foreignKeyName: "workflows_derived_from_workflow_id_fkey"
            columns: ["derived_from_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflow_derivations"
            referencedColumns: ["workflow_id"]
          },
          {
            foreignKeyName: "workflows_derived_from_workflow_id_fkey"
            columns: ["derived_from_workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflows_track_id_workspace_id_fkey"
            columns: ["track_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          role: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          inbound_domain: string | null
          name: string
          settings: Json
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          inbound_domain?: string | null
          name: string
          settings?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          inbound_domain?: string | null
          name?: string
          settings?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      workflow_derivations: {
        Row: {
          current_source_composition_fingerprint: string | null
          derived_at: string | null
          name: string | null
          source_archived_at: string | null
          source_composition_fingerprint: string | null
          source_modified_at: string | null
          source_modified_since_copy: boolean | null
          source_name: string | null
          source_workflow_id: string | null
          track_id: string | null
          workflow_id: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_track_id_workspace_id_fkey"
            columns: ["track_id", "workspace_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id", "workspace_id"]
          },
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      change_channel_workflow: {
        Args: {
          channel_id: string
          discard_field_values?: boolean
          step_mapping: Json
          workflow_id: string
        }
        Returns: {
          amount: number | null
          archived_at: string | null
          channel_id: string
          created_at: string
          created_by: string | null
          currency: string
          current_step_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          email_local_part: string
          entered_step_at: string
          health_score: number | null
          id: string
          next_action: string | null
          next_action_at: string | null
          owner_id: string | null
          position: number
          probability_override: number | null
          search_tsv: unknown
          snoozed_until: string | null
          title: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "cards"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chemin_dossier_card: { Args: { p_card_id: string }; Returns: string }
      chemin_dossier_entite: {
        Args: { p_id: string; p_type: string }
        Returns: string
      }
      classer_message_automatiquement: {
        Args: {
          p_in_reply_to?: string
          p_message_id: string
          p_references?: string[]
        }
        Returns: string
      }
      classify_message: {
        Args: { p_card_id: string; p_message_id: string }
        Returns: string
      }
      compare_workflow_versions: {
        Args: { base_version_id: string; target_version_id: string }
        Returns: Json
      }
      copy_workflow_to_track: {
        Args: { new_name?: string; track_id: string; workflow_id: string }
        Returns: string
      }
      dossiers_a_renommer: {
        Args: { p_account_id: string }
        Returns: {
          actual_path: string
          entity_id: string
          entity_type: string
          nouveau_chemin: string
          profondeur: number
          requested_path: string
        }[]
      }
      etat_messagerie: {
        Args: never
        Returns: {
          account_id: string
          en_attente: number
          en_echec: number
          label: string
          last_error: string
          last_sync_at: string
          status: string
        }[]
      }
      inbox_arborescence: {
        Args: never
        Returns: {
          card_id: string
          card_title: string
          channel_id: string
          channel_name: string
          nombre: number
          track_id: string
          track_name: string
        }[]
      }
      mail_folder_map_reparenter: {
        Args: {
          p_account_id: string
          p_ancien_prefixe: string
          p_nouveau_prefixe: string
        }
        Returns: number
      }
      mail_inbound_account_credentials: {
        Args: { p_account_id: string }
        Returns: {
          account_id: string
          imap_host: string
          imap_port: number
          imap_security: string
          imap_username: string
          password: string
          workspace_id: string
        }[]
      }
      mail_inbound_account_record_check: {
        Args: { p_account_id: string; p_error?: string; p_status: string }
        Returns: string
      }
      mail_outbound_identity_credentials: {
        Args: { p_identity_id: string }
        Returns: {
          from_address: string
          identity_id: string
          password: string
          smtp_host: string
          smtp_port: number
          smtp_security: string
          smtp_username: string
          workspace_id: string
        }[]
      }
      mail_outbound_identity_record_check: {
        Args: { p_error?: string; p_identity_id: string; p_status: string }
        Returns: string
      }
      marquer_envoi_echoue: {
        Args: { p_code: string; p_outbox_id: string }
        Returns: undefined
      }
      marquer_envoi_reussi: {
        Args: {
          p_outbox_id: string
          p_references?: string[]
          p_rfc822_message_id: string
        }
        Returns: string
      }
      marquer_message_range: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      messages_a_ranger: {
        Args: { p_account_id: string }
        Returns: {
          card_id: string
          folder: string
          message_id: string
          uid: number
        }[]
      }
      move_card: {
        Args: { card_id: string; comment?: string; to_step_id: string }
        Returns: {
          amount: number | null
          archived_at: string | null
          channel_id: string
          created_at: string
          created_by: string | null
          currency: string
          current_step_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          email_local_part: string
          entered_step_at: string
          health_score: number | null
          id: string
          next_action: string | null
          next_action_at: string | null
          owner_id: string | null
          position: number
          probability_override: number | null
          search_tsv: unknown
          snoozed_until: string | null
          title: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      move_card_to_channel: {
        Args: {
          card_id: string
          discard_field_values?: boolean
          to_channel_id: string
          to_step_id?: string
        }
        Returns: {
          amount: number | null
          archived_at: string | null
          channel_id: string
          created_at: string
          created_by: string | null
          currency: string
          current_step_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          email_local_part: string
          entered_step_at: string
          health_score: number | null
          id: string
          next_action: string | null
          next_action_at: string | null
          owner_id: string | null
          position: number
          probability_override: number | null
          search_tsv: unknown
          snoozed_until: string | null
          title: string
          updated_at: string
          workflow_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plan_card_remapping: {
        Args: {
          card_limit?: number
          step_overrides?: Json
          target_version_id: string
        }
        Returns: Json
      }
      previsualiser_exigence: {
        Args: {
          p_field_id: string
          p_step_id?: string
          p_transition_id?: string
        }
        Returns: {
          a_l_entree: number
          sur_place: number
        }[]
      }
      publish_workflow_version: {
        Args: { note?: string; target_workflow_id: string }
        Returns: {
          composition: Json
          composition_fingerprint: string
          id: string
          note: string | null
          published_at: string
          published_by: string | null
          version_number: number
          workflow_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workflow_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      queue_outbound_email: {
        Args: {
          p_body_text?: string
          p_card_id: string
          p_cc?: string[]
          p_identity_id: string
          p_in_reply_to_message_id?: string
          p_subject?: string
          p_to: string[]
        }
        Returns: string
      }
      reprendre_envois_orphelins: {
        Args: { p_seuil_minutes?: number }
        Returns: number
      }
      reprogrammer_envoi: {
        Args: { p_code: string; p_delai_secondes: number; p_outbox_id: string }
        Returns: number
      }
      reserver_envois: {
        Args: { p_limite?: number }
        Returns: {
          attempts: number
          body_text: string
          card_id: string
          cc_addrs: string[]
          from_address: string
          identity_id: string
          in_reply_to: string
          outbox_id: string
          references_ids: string[]
          reply_to: string
          smtp_host: string
          smtp_port: number
          smtp_security: string
          smtp_username: string
          subject: string
          to_addrs: string[]
        }[]
      }
      upsert_mail_inbound_account: {
        Args: {
          p_backfill_months?: number
          p_folder_style?: string
          p_imap_host: string
          p_imap_port: number
          p_imap_security: string
          p_imap_username: string
          p_label: string
          p_owner_id?: string
          p_password?: string
          p_watch_folders?: string[]
          p_workspace_id: string
        }
        Returns: string
      }
      upsert_mail_outbound_identity: {
        Args: {
          p_daily_quota?: number
          p_from_address: string
          p_from_name?: string
          p_is_default?: boolean
          p_label: string
          p_owner_id?: string
          p_password?: string
          p_signature_html?: string
          p_smtp_host: string
          p_smtp_port: number
          p_smtp_security: string
          p_smtp_username: string
          p_workspace_id: string
        }
        Returns: string
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
  public: {
    Enums: {},
  },
} as const
