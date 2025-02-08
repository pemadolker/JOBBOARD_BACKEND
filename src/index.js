import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// Load environment variables from .env file
dotenv.config();

// Initialize the Hono app and Supabase client
const app = new Hono();
const supabase = createClient(
  process.env.SUPABASE_URL, // URL of your Supabase project
  process.env.SUPABASE_ANON_KEY // Anon key for authentication
);

// Middleware: Enable CORS for frontend integration
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', 'http://localhost:3000'); // Replace with your frontend URL
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') {
    return c.text('', 204);
  }
  await next();
});

// Root endpoint to verify the server is running
app.get('/', (c) => {
  return c.text('Welcome to JobBoard!');
});

// Middleware to verify JWT token
const authenticate = async (c, next) => {
  try {
    const authHeader = c.req.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization token is required' }, 401);
    }

    const token = authHeader.split(' ')[1];
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET_KEY); // Ensure this matches the key used for signing the token
    const { userId } = decodedToken;

    // Add user data to context for use in subsequent routes
    c.user = { userId };

    await next(); // Proceed to the next handler
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

// Endpoint for user signup
app.post('/signup', async (c) => {
  try {
    const {
      email,
      password,
      role,
      name,
      company_name,
      company_description,
      website_url,
      contact_number,
      resume, // Base64 encoded file (not required at signup)
      portfolio_url,
      skills,
      education,
      work_experience,
      location,
    } = await c.req.json();

    const userName = role === 'employer' ? company_name : name;

    // Step 1: Create user in Supabase authentication
    const { user, error: signupError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signupError) {
      console.log("Signup error:", signupError.message);
      return c.json({ error: signupError.message }, 400);
    }

    // Step 2: Insert the user into the 'users' table
    const { data: userData, error: userInsertError } = await supabase
      .from('users')
      .insert({
        email,
        password,
        role,
        name: userName,
      })
      .select()
      .single();

    if (userInsertError) {
      console.log("User insert error:", userInsertError.message);
      return c.json({ error: userInsertError.message }, 400);
    }

    const userId = userData.user_id;

    if (role === 'job_seeker') {
      const { error: jobSeekerError } = await supabase
        .from('job_seekers')
        .insert({
          resume: null,
          portfolio_url,
          skills,
          education,
          work_experience,
          contact_number,
          location,
          user_id: userId,
        })
        .select()
        .single();

      if (jobSeekerError) {
        console.log("Job seeker insert error:", jobSeekerError.message);
        return c.json({ error: jobSeekerError.message }, 400);
      }
    } else if (role === 'employer') {
      const { error: employerError } = await supabase
        .from('employers')
        .insert({
          company_name,
          company_description,
          website_url,
          contact_number,
          location,
          user_id: userId,
        })
        .select()
        .single();

      if (employerError) {
        console.log("Employer insert error:", employerError.message);
        return c.json({ error: employerError.message }, 400);
      }
    }

    return c.json({ message: 'User created successfully!', user: userData });
  } catch (error) {
    console.error("Error during signup:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Endpoint for user signin
app.post('/signin', async (c) => {
  try {
    const { email, password } = await c.req.json();

    const { data: { user }, error: signinError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signinError) {
      return c.json({ error: signinError.message }, 400);
    }

    if (!user.email_confirmed_at) {
      return c.json({ error: 'Please confirm your email before signing in.' }, 400);
    }

    const { data: userData, error: roleFetchError } = await supabase
      .from('users')
      .select('user_id, role')
      .eq('email', email)
      .single();

    if (roleFetchError || !userData) {
      return c.json({ error: 'Unable to fetch user role' }, 500);
    }

    // Generate a JWT token after successful signin
    const token = jwt.sign(
      { userId: userData.user_id, role: userData.role },  // Use user_id from users table
      process.env.JWT_SECRET_KEY,
      { expiresIn: '1h' }
    );

    return c.json({ message: 'User signed in successfully', role: userData.role, token });
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});
// Endpoint to post a job
app.post('/employer/jobs', async (c) => {
  try {
    const jobData = await c.req.json();

    const { em_id, application_deadline } = jobData;

    if (!em_id) {
      return c.json({ error: 'Employer ID is required' }, 400);
    }

    if (!application_deadline) {
      return c.json({ error: 'Application deadline is required' }, 400);
    }

    // Insert new job posting
    const { error: jobError } = await supabase
      .from('job_postings')
      .insert({
        ...jobData,
        em_id: em_id,
        application_deadline: application_deadline, // Correct field name for database
        status: 'open',
        created_at: new Date(),
        updated_at: new Date(),
      });

    if (jobError) {
      console.error('Error creating job posting:', jobError.message);
      return c.json({ error: jobError.message }, 500);
    }

    return c.json({ message: 'Job posted successfully!' });
  } catch (error) {
    console.error('Error during job posting:', error.message);
    return c.json({ error: error.message }, 500);
  }
});


// Protected route to get user profile
app.get('/profile', authenticate, async (c) => {
  const userId = c.user.userId;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({ user: data });
});

// Endpoint to handle email confirmation and redirect users based on role
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
    return c.redirect('http://localhost:3000/employer');
  } else if (userData.role === 'job_seeker') {
    return c.redirect('http://localhost:3000/dashboard/seekerDashboard');
  } else {
    return c.json({ error: 'Invalid role' }, 400);
  }
});

// Define the port for the server
const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

// Start the server
serve({
  fetch: app.fetch,
  port,
});
