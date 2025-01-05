import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

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
  c.header('Access-Control-Allow-Origin', 'http://localhost:3000'); // Replace with your Next.js domain
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

// Endpoint for user signup
app.post('/signup', async (c) => {
  try {
    const { 
      email, password, role, name, company_name, company_description, 
      website_url, contact_number, resume, portfolio_url, skills, 
      education, location 
    } = await c.req.json();

    // Determine the name for the users table
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
        name: userName, // Store company_name as name for employers
      })
      .select()
      .single();

    if (userInsertError) {
      console.log("User insert error:", userInsertError.message);
      return c.json({ error: userInsertError.message }, 400);
    }

    const userId = userData.user_id; // Get the user ID for additional inserts

 // Step 3: Insert role-specific details
if (role === 'employer') {
  // Insert employer-specific data into the 'employers' table
  const { error: employerError, data: employerData } = await supabase
    .from('employers')
    .insert({
      company_name,
      company_description,
      website_url,
      contact_number,
      location,
      user_id: userId, // Foreign key linking to 'users'
    })
    .select()
    .single();

  if (employerError) {
    console.log("Employer insert error:", employerError.message);
    return c.json({ error: employerError.message }, 400);
  }

  console.log("Employer data inserted:", employerData); // Log employer data
} else if (role === 'job_seeker') {
  // Insert job seeker-specific data into the 'job_seekers' table
  const { error: jobSeekerError, data: jobSeekerData } = await supabase
    .from('job_seekers')
    .insert({
      resume,
      portfolio_url,
      skills,
      education,
      contact_number,
      location,
      user_id: userId, // Foreign key linking to 'users'
    })
    .select()
    .single();

  if (jobSeekerError) {
    console.log("Job seeker insert error:", jobSeekerError.message);
    return c.json({ error: jobSeekerError.message }, 400);
  }

  console.log("Job seeker data inserted:", jobSeekerData); // Log job seeker data
}


    // Return success response if everything works
    return c.json({ message: 'User created successfully!', user: userData });
  } catch (error) {
    // Handle unexpected errors
    console.error("Error during signup:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Endpoint for user signin
app.post('/signin', async (c) => {
  try {
    // Parse the request body for email and password
    const { email, password } = await c.req.json();

    // Authenticate user with Supabase
    const { data: { user }, error: signinError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // Handle authentication errors
    if (signinError) {
      console.log("Signin error:", signinError.message);
      return c.json({ error: signinError.message }, 400);
    }

    // Return success response with user details
    return c.json({ message: 'User signed in successfully', user });
  } catch (error) {
    // Handle unexpected errors
    console.error("Error during signin:", error);
    return c.json({ error: error.message }, 500);
  }
});

// Endpoint to handle email confirmation and redirect users based on role
app.get('/auth/callback', async (c) => {
  // Get authenticated user details
  const { user } = await supabase.auth.getUser();
  
  if (!user) {
    return c.json({ error: 'User not authenticated' }, 400);
  }

  // Fetch user's role from the 'users' table
  const { data: userData, error: fetchError } = await supabase
    .from('users')
    .select('role')
    .eq('user_id', user.id)
    .single();

  // Handle errors if the user is not found
  if (fetchError || !userData) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Redirect users to role-specific dashboards
  if (userData.role === 'employer') {
    return c.redirect('http://localhost:3000/employer');
  } else if (userData.role === 'job_seeker') {
    return c.redirect('http://localhost:3000/dashboard/seekerdashboard');
  } else {
    return c.json({ error: 'Invalid role' }, 400);
  }
});

// Define the port for the server
const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

// Start the server
serve({
  fetch: app.fetch, // Use Hono's fetch handler
  port,
});
