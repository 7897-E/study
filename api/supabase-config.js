export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const publishableKey = process.env.SUPABASE_ANON_KEY || '';

  if (!url || !publishableKey) {
    return res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables'
    });
  }

  return res.status(200).json({ url, publishableKey });
}
