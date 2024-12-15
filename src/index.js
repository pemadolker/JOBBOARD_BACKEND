
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Hono app
const app = new Hono();
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get('/', (c) => {
  return c.text('Welcome to JobBoard!');
});

// Signup Endpoint
app.post('/signup', async (c) => {
  try {
    const { email, password, role, name, company_name, company_description, company_logo, website_url, contact_number, resume, portfolio_url, skills, work_experience, education, linkedin_url } = await c.req.json();

    // Create user in Supabase
    const { user, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      return c.json({ error: signupError.message }, 400);
    }

    // Assuming 'role' is either 'employer' or 'job_seeker'
    const userRole = role === 'employer' ? 'employer' : 'job_seeker';

    // Insert user into your custom 'users' table
    await supabase.from('users').upsert({
      user_id: user?.id,
      name,
      email,
      role: userRole,
    });

    // Insert into respective tables based on user role
    if (role === 'employer') {
      // Insert employer-specific details
      await supabase.from('employers').upsert({
        company_name,
        company_description,
        company_logo,
        website_url,
        contact_number,
        user_id: user?.id,
      });
    } else if (role === 'job_seeker') {
      // Insert job seeker-specific details
      await supabase.from('job_seekers').upsert({
        resume,
        portfolio_url,
        skills,
        work_experience,
        education,
        linkedin_url,
        contact_number,
        user_id: user?.id,
      });
    }

    return c.json({ message: 'Confirmation email sent!', user });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

// Signin Endpoint
app.post('/signin', async (c) => {
  try {
    const { email, password } = await c.req.json();

    // Sign in with Supabase
    const { data: { user }, error: signinError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signinError) {
      return c.json({ error: signinError.message }, 400);
    }

    return c.json({ message: 'User signed in successfully', user });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});
// Handle Email Confirmation (Redirect after signup)
app.get('/auth/callback', async (c) => {
  // Assuming the user is authenticated (check if the user is logged in)
  const { user } = await supabase.auth.getUser();
  
  if (!user) {
    return c.json({ error: 'User not authenticated' }, 400);
  }

  // Fetch the user's role from the 'users' table
  const { data: userData, error: fetchError } = await supabase
    .from('users')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (fetchError || !userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Redirect to the respective dashboard based on the role
  if (userData.role === 'employer') {
    return c.redirect('/employer/dashboard');
  } else if (userData.role === 'job_seeker') {
    return c.redirect('/job-seeker/dashboard');
  } else {
    return c.json({ error: 'Invalid role' }, 400);
  }
});
// Define the port
const port = 3000;
console.log(`Server is running on http://localhost:${port}`);

// Use the `serve` function to start the server
serve({
  fetch: app.fetch,
  port,
});
