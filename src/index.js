import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { cors } from 'hono/cors'

dotenv.config();

// Initialize Hono app
const app = new Hono();
app.use('*', cors());
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
    const { 
      email, password, role, name, company_name, company_description, 
      website_url, contact_number, resume, portfolio_url, skills, 
      education, location 
    } = await c.req.json();

    // Step 1: Create user in Supabase Auth
    const { user, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      console.log("Signup error:", signupError.message);
      return c.json({ error: signupError.message }, 400);
    }

    // Step 2: Insert user into the 'users' table
    const { data: userData, error: userInsertError } = await supabase
      .from('users')
      .insert({
        email,
        password, // Optional: Store encrypted passwords instead of plain text
        role,
        name: role === 'employer' ? null : name, // Insert 'name' only for job seekers
      })
      .select()
      .single();

    if (userInsertError) {
      console.log("User insert error:", userInsertError.message);
      return c.json({ error: userInsertError.message }, 400);
    }

    const userId = userData.user_id; // Use this ID for the foreign key inserts

    // Step 3: Insert into employer or job_seeker table based on role
    if (role === 'employer') {
      const { error: employerError } = await supabase
        .from('employers')
        .insert({
          company_name,
          company_description,
          website_url,
          contact_number,
          location,
          user_id: userId, // Use the correct user_id from 'users'
        });

      if (employerError) {
        console.log("Employer insert error:", employerError.message);
        return c.json({ error: employerError.message }, 400);
      }
    } else if (role === 'job_seeker') {
      const { error: jobSeekerError } = await supabase
        .from('job_seekers')
        .insert({
          resume,
          portfolio_url,
          skills,
          education,
          contact_number,
          location,
          user_id: userId, // Use the correct user_id from 'users'
        });

      if (jobSeekerError) {
        console.log("Job seeker insert error:", jobSeekerError.message);
        return c.json({ error: jobSeekerError.message }, 400);
      }
    }

    // Final success message
    return c.json({ message: 'User created successfully!', user: userData });
  } catch (error) {
    console.error("Error during signup:", error);
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
      console.log("Signin error:", signinError.message);
      return c.json({ error: signinError.message }, 400);
    }

    return c.json({ message: 'User signed in successfully', user });
  } catch (error) {
    console.error("Error during signin:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Handle Email Confirmation (Redirect after signup)
app.get('/auth/callback', async (c) => {
  const { user } = await supabase.auth.getUser();
  
  if (!user) {
    return c.json({ error: 'User not authenticated' }, 400);
  }

  const { data: userData, error: fetchError } = await supabase
    .from('users')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (fetchError || !userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  if (userData.role === 'employer') {
    return c.redirect('/employer/dashboard');
  } else if (userData.role === 'job_seeker') {
    return c.redirect('/job-seeker/dashboard');
  } else {
    return c.json({ error: 'Invalid role' }, 400);
  }
});

// Define the port
const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

// Use the serve function to start the server
serve({
  fetch: app.fetch,
  port,
});
