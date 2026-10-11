export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          owner: string
          repo: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          owner: string
          repo: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          owner?: string
          repo?: string
          target_user_id?: string | null
        }
        Relationships: []
      }
      ai_explain_cache: {
        Row: {
          content_hash: string
          created_at: string
          explanation: string
          id: string
          language: string | null
          path: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          explanation: string
          id: string
          language?: string | null
          path: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          explanation?: string
          id?: string
          language?: string | null
          path?: string
        }
        Relationships: []
      }
      channel_members: {
        Row: {
          channel_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          joined_at?: string
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
        ]
      }
      channels: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          topic: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          topic?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          topic?: string | null
        }
        Relationships: []
      }
      gh_file_cache: {
        Row: {
          content: string
          fetched_at: string
          id: string
          owner: string
          path: string
          ref: string
          repo: string
          truncated: boolean
        }
        Insert: {
          content: string
          fetched_at?: string
          id: string
          owner: string
          path: string
          ref: string
          repo: string
          truncated?: boolean
        }
        Update: {
          content?: string
          fetched_at?: string
          id?: string
          owner?: string
          path?: string
          ref?: string
          repo?: string
          truncated?: boolean
        }
        Relationships: []
      }
      gh_repo_cache: {
        Row: {
          data: Json
          default_branch: string
          fetched_at: string
          id: string
          owner: string
          ref: string
          repo: string
        }
        Insert: {
          data: Json
          default_branch: string
          fetched_at?: string
          id: string
          owner: string
          ref: string
          repo: string
        }
        Update: {
          data?: Json
          default_branch?: string
          fetched_at?: string
          id?: string
          owner?: string
          ref?: string
          repo?: string
        }
        Relationships: []
      }
      github_app_installations: {
        Row: {
          account_avatar_url: string | null
          account_id: number
          account_login: string
          account_type: string
          created_at: string
          id: number
          repository_selection: string
          suspended_at: string | null
          target_type: string | null
          updated_at: string
        }
        Insert: {
          account_avatar_url?: string | null
          account_id: number
          account_login: string
          account_type: string
          created_at?: string
          id: number
          repository_selection?: string
          suspended_at?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Update: {
          account_avatar_url?: string | null
          account_id?: number
          account_login?: string
          account_type?: string
          created_at?: string
          id?: number
          repository_selection?: string
          suspended_at?: string | null
          target_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      github_installation_users: {
        Row: {
          created_at: string
          installation_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          installation_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          installation_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installation_users_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "github_app_installations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_user_identities: {
        Row: {
          created_at: string
          gh_login: string
          gh_user_id: number
          oauth_access_token_enc: string
          oauth_expires_at: string | null
          oauth_refresh_expires_at: string | null
          oauth_refresh_token_enc: string | null
          scopes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gh_login: string
          gh_user_id: number
          oauth_access_token_enc: string
          oauth_expires_at?: string | null
          oauth_refresh_expires_at?: string | null
          oauth_refresh_token_enc?: string | null
          scopes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gh_login?: string
          gh_user_id?: number
          oauth_access_token_enc?: string
          oauth_expires_at?: string | null
          oauth_refresh_expires_at?: string | null
          oauth_refresh_token_enc?: string | null
          scopes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          kind: string
          message: string | null
          progress: number
          result: Json | null
          status: string
          target: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          message?: string | null
          progress?: number
          result?: Json | null
          status?: string
          target: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          message?: string | null
          progress?: number
          result?: Json | null
          status?: string
          target?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          channel_id: string
          content: string
          created_at: string
          id: string
          mentions: string[]
          user_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          channel_id: string
          content?: string
          created_at?: string
          id?: string
          mentions?: string[]
          user_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          channel_id?: string
          content?: string
          created_at?: string
          id?: string
          mentions?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          username?: string
        }
        Relationships: []
      }
      repo_chunks: {
        Row: {
          chunk_index: number
          content: string
          id: string
          indexed_at: string
          language: string | null
          owner: string
          path: string
          ref: string
          repo: string
          token_count: number
          tsv: unknown
        }
        Insert: {
          chunk_index?: number
          content: string
          id?: string
          indexed_at?: string
          language?: string | null
          owner: string
          path: string
          ref: string
          repo: string
          token_count?: number
          tsv?: unknown
        }
        Update: {
          chunk_index?: number
          content?: string
          id?: string
          indexed_at?: string
          language?: string | null
          owner?: string
          path?: string
          ref?: string
          repo?: string
          token_count?: number
          tsv?: unknown
        }
        Relationships: []
      }
      repository_access_requests: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          message: string | null
          owner: string
          repo: string
          requested_role: Database["public"]["Enums"]["repo_role"]
          requester_id: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["access_request_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          owner: string
          repo: string
          requested_role?: Database["public"]["Enums"]["repo_role"]
          requester_id: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          message?: string | null
          owner?: string
          repo?: string
          requested_role?: Database["public"]["Enums"]["repo_role"]
          requester_id?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["access_request_status"]
          updated_at?: string
        }
        Relationships: []
      }
      repository_collaborators: {
        Row: {
          created_at: string
          id: string
          owner: string
          repo: string
          role: Database["public"]["Enums"]["repo_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner: string
          repo: string
          role: Database["public"]["Enums"]["repo_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          owner?: string
          repo?: string
          role?: Database["public"]["Enums"]["repo_role"]
          user_id?: string
        }
        Relationships: []
      }
      repository_permissions: {
        Row: {
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          owner: string
          repo: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["repo_role"]
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          owner: string
          repo: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["repo_role"]
          user_id: string
        }
        Update: {
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          owner?: string
          repo?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["repo_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_github_tokens: {
        Row: {
          created_at: string
          gh_login: string | null
          gh_user_id: string | null
          last_verified_at: string | null
          last_verified_reason: string | null
          last_verified_status: string | null
          scopes: string | null
          token: string | null
          token_encrypted: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          gh_login?: string | null
          gh_user_id?: string | null
          last_verified_at?: string | null
          last_verified_reason?: string | null
          last_verified_status?: string | null
          scopes?: string | null
          token?: string | null
          token_encrypted?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          gh_login?: string | null
          gh_user_id?: string | null
          last_verified_at?: string | null
          last_verified_reason?: string | null
          last_verified_status?: string | null
          scopes?: string | null
          token?: string | null
          token_encrypted?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      workspace_files: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          gh_owner: string | null
          gh_ref: string | null
          gh_repo: string | null
          id: string
          language: string | null
          path: string
          source: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content?: string
          created_at?: string
          created_by?: string | null
          gh_owner?: string | null
          gh_ref?: string | null
          gh_repo?: string | null
          id?: string
          language?: string | null
          path: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          gh_owner?: string | null
          gh_ref?: string | null
          gh_repo?: string | null
          id?: string
          language?: string | null
          path?: string
          source?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_active_repo_access: {
        Args: { _owner: string; _repo: string; _user: string }
        Returns: boolean
      }
      has_repo_role: {
        Args: {
          _owner: string
          _repo: string
          _roles: Database["public"]["Enums"]["repo_role"][]
          _user: string
        }
        Returns: boolean
      }
      is_channel_member: {
        Args: { _channel: string; _user: string }
        Returns: boolean
      }
      search_repo_chunks: {
        Args: {
          _limit?: number
          _owner: string
          _query: string
          _ref: string
          _repo: string
        }
        Returns: {
          chunk_index: number
          content: string
          language: string
          path: string
          rank: number
        }[]
      }
    }
    Enums: {
      access_request_status:
        | "pending"
        | "approved"
        | "rejected"
        | "revoked"
        | "expired"
      repo_role: "owner" | "admin" | "editor" | "viewer"
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
    Enums: {
      access_request_status: [
        "pending",
        "approved",
        "rejected",
        "revoked",
        "expired",
      ],
      repo_role: ["owner", "admin", "editor", "viewer"],
    },
  },
} as const
