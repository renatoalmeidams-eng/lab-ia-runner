setInterval(async () => {
  try {
    const res = await fetch("https://vshanjsktdngwlzcfdlc.supabase.co/functions/v1/processar-tarefa", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzaGFuanNrdGRuZ3dsemNmZGxjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDE1NDE1OCwiZXhwIjoyMDg5NzMwMTU4fQ.nINfqUKx_7gK4_WFFCoEGQ4iz-Y3cLxrplpySh9nRPs"
      },
      body: "{}"
    });

    const text = await res.text();
    console.log("Cron:", text);
  } catch (err) {
    console.error("Erro cron:", err);
  }
}, 15000);