const { createClient } = require('@supabase/supabase-js');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, email, answers, recommendations } = req.body;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase credentials are missing in environment variables' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (id) {
      // Update existing record with email
      const { data, error } = await supabase
        .from('quiz_submissions')
        .update({ email })
        .eq('id', id)
        .select()
        .single();
        
      if (error) {
        console.error('Supabase update error:', error);
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({ success: true, data });
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from('quiz_submissions')
        .insert([{
          answers, // JSON objects will automatically be mapped to JSONB by Supabase
          recommendations
        }])
        .select()
        .single();

      if (error) {
        console.error('Supabase insert error:', error);
        return res.status(400).json({ error: error.message });
      }
      return res.status(200).json({ success: true, data });
    }
  } catch (err) {
    console.error('Database error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
