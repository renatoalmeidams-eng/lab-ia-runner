import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const { ideia } = await req.json();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: projeto } = await supabase
    .from("projetos")
    .insert({ ideia })
    .select()
    .single();

  const { data: exec } = await supabase
    .from("execucoes")
    .insert({ projeto_id: projeto.id })
    .select()
    .single();

  await supabase.from("nos_execucao").insert({
    execucao_id: exec.id,
    tipo_agente: "pesquisador",
    input: { ideia },
  });

  return new Response(JSON.stringify({ projeto_id: projeto.id }));
});