require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const connectDB = require('../config/database');

const seedData = async () => {
  try {
    await connectDB();

    // Clear existing data
    await User.deleteMany({});
    await Course.deleteMany({});

    // Create Admin
    const admin = await User.create({
      name: 'Admin User',
      email: 'admin@lms.com',
      password: 'admin123',
      role: 'admin',
      status: 'active',
    });

    console.log('✓ Admin created');

    // Create Instructors
    const instructor1 = await User.create({
      name: 'John Instructor',
      email: 'instructor1@lms.com',
      password: 'instructor123',
      role: 'instructor',
      status: 'active',
    });

    const instructor2 = await User.create({
      name: 'Jane Instructor',
      email: 'instructor2@lms.com',
      password: 'instructor123',
      role: 'instructor',
      status: 'active',
    });

    console.log('✓ Instructors created');

    // Create Students
    const students = [];
    for (let i = 1; i <= 10; i++) {
      const batch = i % 2 === 0 ? 'longTerm' : 'shortTerm';
      const student = await User.create({
        name: `Student ${i}`,
        email: `student${i}@lms.com`,
        password: 'student123',
        role: 'student',
        status: 'active',
        batch,
      });
      students.push(student);
    }

    console.log('✓ Students created');

    // Create Courses
    const course1 = await Course.create({
      title: 'Introduction to Web Development',
      description: 'Learn the fundamentals of web development including HTML, CSS, and JavaScript.',
      term: 'longTerm',
      level: 'Beginner',
      thumbnailUrl: 'https://via.placeholder.com/300x200',
      visibility: 'published',
      instructorId: instructor1._id,
      modules: [
        {
          title: 'HTML Basics',
          order: 1,
          lessons: [
            {
              title: 'Introduction to HTML',
              description: 'Learn what HTML is and how it works',
              type: 'video',
              url: 'https://example.com/video1.mp4',
              durationSeconds: 600,
              order: 1,
            },
            {
              title: 'HTML Elements and Tags',
              description: 'Understanding HTML elements and tags',
              type: 'pdf',
              url: 'https://example.com/pdf1.pdf',
              order: 2,
            },
          ],
        },
        {
          title: 'CSS Fundamentals',
          order: 2,
          lessons: [
            {
              title: 'Introduction to CSS',
              description: 'Learn CSS basics',
              type: 'video',
              url: 'https://example.com/video2.mp4',
              durationSeconds: 720,
              order: 1,
            },
            {
              title: 'CSS Quiz',
              description: 'Test your CSS knowledge',
              type: 'quiz',
              url: 'https://example.com/quiz1',
              order: 2,
            },
          ],
        },
      ],
    });

    const course2 = await Course.create({
      title: 'Advanced JavaScript',
      description: 'Deep dive into JavaScript concepts including ES6+, async/await, and design patterns.',
      term: 'shortTerm',
      level: 'Advanced',
      thumbnailUrl: 'https://via.placeholder.com/300x200',
      visibility: 'published',
      instructorId: instructor2._id,
      modules: [
        {
          title: 'ES6+ Features',
          order: 1,
          lessons: [
            {
              title: 'Arrow Functions',
              description: 'Understanding arrow functions',
              type: 'video',
              url: 'https://example.com/video3.mp4',
              durationSeconds: 900,
              order: 1,
            },
            {
              title: 'Destructuring',
              description: 'Learn destructuring in JavaScript',
              type: 'video',
              url: 'https://example.com/video4.mp4',
              durationSeconds: 600,
              order: 2,
            },
          ],
        },
      ],
    });

    const course3 = await Course.create({
      title: 'Full Stack Development',
      description: 'Complete guide to full stack development with Node.js and React.',
      term: 'both',
      level: 'Intermediate',
      thumbnailUrl: 'https://via.placeholder.com/300x200',
      visibility: 'published',
      instructorId: instructor1._id,
      modules: [
        {
          title: 'Backend Development',
          order: 1,
          lessons: [
            {
              title: 'Node.js Basics',
              description: 'Introduction to Node.js',
              type: 'video',
              url: 'https://example.com/video5.mp4',
              durationSeconds: 1200,
              order: 1,
            },
          ],
        },
        {
          title: 'Frontend Development',
          order: 2,
          lessons: [
            {
              title: 'React Fundamentals',
              description: 'Learn React basics',
              type: 'video',
              url: 'https://example.com/video6.mp4',
              durationSeconds: 1500,
              order: 1,
            },
          ],
        },
      ],
    });

    console.log('✓ Courses created');

    console.log('\n=== Seed Data Summary ===');
    console.log(`Admin: ${admin.email} / admin123`);
    console.log(`Instructor 1: ${instructor1.email} / instructor123`);
    console.log(`Instructor 2: ${instructor2.email} / instructor123`);
    console.log(`Students: student1@lms.com to student10@lms.com / student123`);
    console.log(`Courses: ${course1.title}, ${course2.title}, ${course3.title}`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
};

seedData();


