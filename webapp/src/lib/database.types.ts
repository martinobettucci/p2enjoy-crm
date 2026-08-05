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
      workflow_transitions: {
        Row: {
          created_at: string
          from_step_id: string
          id: string
          label: string | null
          require_comment: boolean
          require_fields: string[]
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
          require_fields?: string[]
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
          require_fields?: string[]
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
          derived_at: string | null
          name: string | null
          source_archived_at: string | null
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
      copy_workflow_to_track: {
        Args: { new_name?: string; track_id: string; workflow_id: string }
        Returns: string
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
