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

    // Check if email is confirmed
    if (!user.email_confirmed_at) {
      return c.json({ error: 'Please confirm your email before signing in.' }, 400);
    }

    // Return success response with user details
    return c.json({ message: 'User signed in successfully', user });
  } catch (error) {
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
//dashboard job recommendations for the seekers
app.get('/dashboard/seekerdashboard/jobs', async (c) => {
  try {
    const { user } = await supabase.auth.getUser();

    if (!user) {
      return c.json({ error: 'User not authenticated' }, 400);
    }

    const { data: jobRecommendations, error: fetchError } = await supabase
      .from('job_postings')
      .select();

    if (fetchError) {
      console.log("Couldn't fetch job recommendations:", fetchError.message);
      return c.json({ error: fetchError.message }, 400);
    }

    return c.json({ jobRecommendations });
  } catch (error) {
    console.error("Error during job recommendations fetch:", error);
    return c.json({ error: error.message }, 500);
  }
});

// endpoint for handling the profile updating and fetching for the job seekers
app.use('/dashboard/seekerDashboard/profile', async (c, next) => {
  try {
    const { user } = await supabase.auth.getUser();

    if (!user) {
      return c.json({ error: 'User not authenticated' }, 401);
    }

    if (c.req.method === 'GET') {
      // Handle fetching the user's profile data (viewing)
      const { data, error } = await supabase
        .from('job_seekers')
        .select('resume, portfolio_url, skills,work_experience, education, contact_number, location')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error("Error fetching profile:", error);
        return c.json({ error: error.message }, 500);
      }

      // Return the profile data to the user
      return c.json({ profile: data });
    }

    if (c.req.method === 'POST' || c.req.method === 'PUT') {
      // Handle updating the user's profile data
      const { resume, portfolio_url, skills, education, contact_number, location } = await c.req.json();

      const { data, error } = await supabase
        .from('job_seekers')
        .upsert({
          user_id: user.id, // Ensure we're updating the right record
          resume,
          portfolio_url,
          skills,
          work_experience,
          education,
          contact_number,
          location,
        });

      if (error) {
        console.error("Error updating profile:", error);
        return c.json({ error: error.message }, 500);
      }

      // Return the updated profile data
      return c.json({ profile: data });
    }

    // If the request method is not recognized, return an error
    return c.json({ error: 'Invalid request method' }, 405);

  } catch (error) {
    console.error("Error during profile handling:", error);
    return c.json({ error: error.message }, 500);
  }
});



// Define the port
const port = 8000;
console.log(`Server is running on http://localhost:${port}`);

// Start the server
serve({
  fetch: app.fetch, // Use Hono's fetch handler
  port,
});
