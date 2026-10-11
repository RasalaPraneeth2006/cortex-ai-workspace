import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { normalizeServerFnErrors } from "@/lib/normalize-serverfn-errors";

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth, normalizeServerFnErrors],
}));