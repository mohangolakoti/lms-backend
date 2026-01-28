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

    // Create Digital Electronics Course
    const digitalElectronicsCourse = await Course.create({
      title: 'Digital Electronics',
      description: 'digital electronics crash course',
      term: 'both',
      level: 'Advanced',
      thumbnailUrl: 'https://via.placeholder.com/300x200',
      visibility: 'published',
      instructorId: instructor1._id,
      modules: [
        {
          title: 'Introduction',
          order: 1,
          lessons: [
            {
              title: 'Why Digital Design?',
              description: 'Understand the importance and applications of digital design',
              type: 'video',
              url: 'https://example.com/de-lesson-1-1.mp4',
              durationSeconds: 900,
              order: 1,
            },
            {
              title: 'Development Timeline',
              description: 'Historical development of digital electronics',
              type: 'pdf',
              url: 'https://example.com/de-lesson-1-2.pdf',
              order: 2,
            },
            {
              title: 'What is Digital',
              description: 'Introduction to digital signals and systems',
              type: 'video',
              url: 'https://example.com/de-lesson-1-3.mp4',
              durationSeconds: 1200,
              order: 3,
            },
          ],
        },
        {
          title: 'Number Systems and Codes',
          order: 2,
          lessons: [
            {
              title: 'Introduction',
              description: 'Overview of number systems',
              type: 'video',
              url: 'https://example.com/de-lesson-2-1.mp4',
              durationSeconds: 1500,
              order: 1,
            },
            {
              title: 'Conversion Techniques',
              description: 'Methods for converting between number systems',
              type: 'pdf',
              url: 'https://example.com/de-lesson-2-2.pdf',
              order: 2,
            },
            {
              title: 'Signed Number Representation',
              description: 'Representation of positive and negative numbers',
              type: 'pdf',
              url: 'https://example.com/de-lesson-2-3.pdf',
              order: 3,
            },
            {
              title: 'Arithmetic Operations',
              description: 'Basic arithmetic in different number systems',
              type: 'pdf',
              url: 'https://example.com/de-lesson-2-4.pdf',
              order: 4,
            },
            {
              title: 'Sign Identification',
              description: 'Identifying signs in binary numbers',
              type: 'video',
              url: 'https://example.com/de-lesson-2-5.mp4',
              durationSeconds: 800,
              order: 5,
            },
            {
              title: 'Codes',
              description: 'Overview of various coding schemes',
              type: 'video',
              url: 'https://example.com/de-lesson-2-6.mp4',
              durationSeconds: 1100,
              order: 6,
            },
            {
              title: 'Binary and Gray codes',
              description: 'Understanding binary and Gray code systems',
              type: 'pdf',
              url: 'https://example.com/de-lesson-2-7.pdf',
              order: 7,
            },
            {
              title: 'Alpha-Numeric codes',
              description: 'Codes for representing alphanumeric characters',
              type: 'pdf',
              url: 'https://example.com/de-lesson-2-8.pdf',
              order: 8,
            },
          ],
        },
        {
          title: 'Boolean Algebra',
          order: 3,
          lessons: [
            {
              title: 'Introduction',
              description: 'Basics of Boolean algebra',
              type: 'video',
              url: 'https://example.com/de-lesson-3-1.mp4',
              durationSeconds: 1300,
              order: 1,
            },
            {
              title: 'Laws of Boolean Algebra',
              description: 'Fundamental laws and theorems of Boolean algebra',
              type: 'pdf',
              url: 'https://example.com/de-lesson-3-2.pdf',
              order: 2,
            },
            {
              title: 'Consensus Theorem',
              description: 'Advanced theorem in Boolean algebra',
              type: 'pdf',
              url: 'https://example.com/de-lesson-3-3.pdf',
              order: 3,
            },
            {
              title: 'Dual vs Complement of a function',
              description: 'Understanding dual and complement operations',
              type: 'video',
              url: 'https://example.com/de-lesson-3-4.mp4',
              durationSeconds: 950,
              order: 4,
            },
          ],
        },
        {
          title: 'Logic Gates',
          order: 4,
          lessons: [
            {
              title: 'Basic gates',
              description: 'Fundamental logic gates and their operations',
              type: 'video',
              url: 'https://example.com/de-lesson-4-1.mp4',
              durationSeconds: 1400,
              order: 1,
            },
            {
              title: 'Exclusive gate properties',
              description: 'XOR and XNOR gate characteristics',
              type: 'pdf',
              url: 'https://example.com/de-lesson-4-2.pdf',
              order: 2,
            },
            {
              title: 'Tri-state Buffers',
              description: 'Three-state logic elements',
              type: 'video',
              url: 'https://example.com/de-lesson-4-3.mp4',
              durationSeconds: 1100,
              order: 3,
            },
            {
              title: 'Logic circuits',
              description: 'Designing and analyzing logic circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-4-4.mp4',
              durationSeconds: 1600,
              order: 4,
            },
            {
              title: 'SOP and POS',
              description: 'Sum of Products and Product of Sums overview',
              type: 'video',
              url: 'https://example.com/de-lesson-4-5.mp4',
              durationSeconds: 1250,
              order: 5,
            },
            {
              title: 'Sum of Products',
              description: 'Detailed explanation of SOP method',
              type: 'pdf',
              url: 'https://example.com/de-lesson-4-6.pdf',
              order: 6,
            },
            {
              title: 'Product of sums',
              description: 'Detailed explanation of POS method',
              type: 'pdf',
              url: 'https://example.com/de-lesson-4-7.pdf',
              order: 7,
            },
            {
              title: 'Conversion of SOP and POS (Vice versa)',
              description: 'Converting between SOP and POS forms',
              type: 'video',
              url: 'https://example.com/de-lesson-4-8.mp4',
              durationSeconds: 1350,
              order: 8,
            },
            {
              title: 'Logic Minimization',
              description: 'Techniques for simplifying logic expressions',
              type: 'pdf',
              url: 'https://example.com/de-lesson-4-9.pdf',
              order: 9,
            },
            {
              title: 'NAND and NOR based Circuits',
              description: 'Building circuits using NAND and NOR gates',
              type: 'video',
              url: 'https://example.com/de-lesson-4-10.mp4',
              durationSeconds: 1200,
              order: 10,
            },
            {
              title: 'NAND and NOR based Circuits (Gate Equivalents)',
              description: 'Gate equivalents and transformations',
              type: 'pdf',
              url: 'https://example.com/de-lesson-4-11.pdf',
              order: 11,
            },
          ],
        },
        {
          title: 'K-Maps',
          order: 5,
          lessons: [
            {
              title: 'Introduction',
              description: 'Introduction to Karnaugh maps',
              type: 'video',
              url: 'https://example.com/de-lesson-5-1.mp4',
              durationSeconds: 1400,
              order: 1,
            },
            {
              title: 'K-map Examples',
              description: 'Worked examples using K-maps',
              type: 'pdf',
              url: 'https://example.com/de-lesson-5-2.pdf',
              order: 2,
            },
            {
              title: 'K-map Structure 5-variable',
              description: 'Understanding 5-variable K-map structure',
              type: 'pdf',
              url: 'https://example.com/de-lesson-5-3.pdf',
              order: 3,
            },
            {
              title: 'K-map Example 5- variable',
              description: 'Worked example with 5-variable K-maps',
              type: 'video',
              url: 'https://example.com/de-lesson-5-4.mp4',
              durationSeconds: 1550,
              order: 4,
            },
            {
              title: 'Don\'t care terms',
              description: 'Using don\'t care conditions in K-maps',
              type: 'pdf',
              url: 'https://example.com/de-lesson-5-5.pdf',
              order: 5,
            },
          ],
        },
        {
          title: 'Combinational Circuits',
          order: 6,
          lessons: [
            {
              title: 'Introduction',
              description: 'Overview of combinational circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-6-1.mp4',
              durationSeconds: 1300,
              order: 1,
            },
            {
              title: 'Combinational Logic Circuits Procedure',
              description: 'Design procedure for combinational circuits',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-2.pdf',
              order: 2,
            },
            {
              title: 'Delays in Combinational Circuits',
              description: 'Understanding propagation delays',
              type: 'video',
              url: 'https://example.com/de-lesson-6-3.mp4',
              durationSeconds: 1100,
              order: 3,
            },
            {
              title: 'Combinational Logic circuits Example',
              description: 'Real-world combinational circuit examples',
              type: 'video',
              url: 'https://example.com/de-lesson-6-4.mp4',
              durationSeconds: 1450,
              order: 4,
            },
            {
              title: 'Adders (Half Adder, Full Adder, 4-bit Adder)',
              description: 'Design and operation of various adder circuits',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-5.pdf',
              order: 5,
            },
            {
              title: 'Subtractor (Half Subtractor, full Subtractor)',
              description: 'Design and operation of subtractor circuits',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-6.pdf',
              order: 6,
            },
            {
              title: 'Comparator',
              description: 'Magnitude comparator circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-6-7.mp4',
              durationSeconds: 1000,
              order: 7,
            },
            {
              title: 'Code Converters',
              description: 'Converting between different code formats',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-8.pdf',
              order: 8,
            },
            {
              title: 'Encoders',
              description: 'Encoder circuits and design',
              type: 'video',
              url: 'https://example.com/de-lesson-6-9.mp4',
              durationSeconds: 1150,
              order: 9,
            },
            {
              title: 'Priority Encoders',
              description: 'Priority encoder design and implementation',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-10.pdf',
              order: 10,
            },
            {
              title: 'Decoders',
              description: 'Decoder circuits and applications',
              type: 'video',
              url: 'https://example.com/de-lesson-6-11.mp4',
              durationSeconds: 1200,
              order: 11,
            },
            {
              title: 'Decoders with active HIGH/LOW enable and output signals',
              description: 'Decoder variants and control signals',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-12.pdf',
              order: 12,
            },
            {
              title: 'Multiplexer and Demultiplexer',
              description: 'MUX and DEMUX circuit design',
              type: 'video',
              url: 'https://example.com/de-lesson-6-13.mp4',
              durationSeconds: 1400,
              order: 13,
            },
            {
              title: 'MUX as Universal logic Block',
              description: 'Using multiplexers for universal logic implementation',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-14.pdf',
              order: 14,
            },
            {
              title: 'Shannon\'s Expression',
              description: 'Shannon expansion and logic decomposition',
              type: 'pdf',
              url: 'https://example.com/de-lesson-6-15.pdf',
              order: 15,
            },
          ],
        },
        {
          title: 'Sequential Circuits',
          order: 7,
          lessons: [
            {
              title: 'Introduction',
              description: 'Overview of sequential circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-1.mp4',
              durationSeconds: 1350,
              order: 1,
            },
            {
              title: 'Memory Block',
              description: 'Basic memory elements in sequential circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-2.mp4',
              durationSeconds: 1200,
              order: 2,
            },
            {
              title: 'Latches',
              description: 'Overview of latch circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-3.mp4',
              durationSeconds: 1150,
              order: 3,
            },
            {
              title: 'NOR based SR Latch',
              description: 'SR latch using NOR gates',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-4.pdf',
              order: 4,
            },
            {
              title: 'NAND based SR Latch',
              description: 'SR latch using NAND gates',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-5.pdf',
              order: 5,
            },
            {
              title: 'Gated SR Latch',
              description: 'Control of SR latch with gate signal',
              type: 'video',
              url: 'https://example.com/de-lesson-7-6.mp4',
              durationSeconds: 1000,
              order: 6,
            },
            {
              title: 'Gated D Latch',
              description: 'D latch with control signal',
              type: 'video',
              url: 'https://example.com/de-lesson-7-7.mp4',
              durationSeconds: 1100,
              order: 7,
            },
            {
              title: 'Key points of latches',
              description: 'Summary of important latch concepts',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-8.pdf',
              order: 8,
            },
            {
              title: 'Synchronous inputs',
              description: 'Synchronous input behavior in sequential circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-9.mp4',
              durationSeconds: 1250,
              order: 9,
            },
            {
              title: 'Master-Slave Configuration',
              description: 'Master-slave flip-flop configuration',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-10.pdf',
              order: 10,
            },
            {
              title: 'Flipflops',
              description: 'Overview of flip-flop circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-11.mp4',
              durationSeconds: 1300,
              order: 11,
            },
            {
              title: 'Truth table vs Excitation table',
              description: 'Difference between truth tables and excitation tables',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-12.pdf',
              order: 12,
            },
            {
              title: 'SR flipflop',
              description: 'SR flip-flop design and operation',
              type: 'video',
              url: 'https://example.com/de-lesson-7-13.mp4',
              durationSeconds: 1150,
              order: 13,
            },
            {
              title: 'D Flipflop',
              description: 'D flip-flop design and applications',
              type: 'video',
              url: 'https://example.com/de-lesson-7-14.mp4',
              durationSeconds: 1200,
              order: 14,
            },
            {
              title: 'JK FLipflop',
              description: 'JK flip-flop design and versatility',
              type: 'video',
              url: 'https://example.com/de-lesson-7-15.mp4',
              durationSeconds: 1250,
              order: 15,
            },
            {
              title: 'T Flipflop',
              description: 'Toggle flip-flop design',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-16.pdf',
              order: 16,
            },
            {
              title: 'Flipflop conversion',
              description: 'Converting between different flip-flop types',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-17.pdf',
              order: 17,
            },
            {
              title: 'Asynchronous Inputs',
              description: 'Preset and clear asynchronous inputs',
              type: 'video',
              url: 'https://example.com/de-lesson-7-18.mp4',
              durationSeconds: 1100,
              order: 18,
            },
            {
              title: 'Delays in Sequential circuits',
              description: 'Propagation and setup/hold delays',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-19.pdf',
              order: 19,
            },
            {
              title: 'Registers',
              description: 'Register design and implementation',
              type: 'video',
              url: 'https://example.com/de-lesson-7-20.mp4',
              durationSeconds: 1350,
              order: 20,
            },
            {
              title: 'Buffer registers',
              description: 'Buffer register circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-21.mp4',
              durationSeconds: 1000,
              order: 21,
            },
            {
              title: 'Shift Registers',
              description: 'Overview of shift register circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-22.mp4',
              durationSeconds: 1200,
              order: 22,
            },
            {
              title: 'Serial Shift registers',
              description: 'Serial input shift registers',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-23.pdf',
              order: 23,
            },
            {
              title: 'Parallel Shift Registers',
              description: 'Parallel input shift registers',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-24.pdf',
              order: 24,
            },
            {
              title: 'Bi-Directional Shift Register',
              description: 'Bidirectional shift register design',
              type: 'video',
              url: 'https://example.com/de-lesson-7-25.mp4',
              durationSeconds: 1150,
              order: 25,
            },
            {
              title: 'Counters',
              description: 'Counter circuit overview',
              type: 'video',
              url: 'https://example.com/de-lesson-7-26.mp4',
              durationSeconds: 1300,
              order: 26,
            },
            {
              title: 'Counter Design',
              description: 'Design procedure for counters',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-27.pdf',
              order: 27,
            },
            {
              title: 'Synchronous UP counter',
              description: 'Synchronous up counter design',
              type: 'video',
              url: 'https://example.com/de-lesson-7-28.mp4',
              durationSeconds: 1200,
              order: 28,
            },
            {
              title: 'Synchronous DOWN counter',
              description: 'Synchronous down counter design',
              type: 'video',
              url: 'https://example.com/de-lesson-7-29.mp4',
              durationSeconds: 1150,
              order: 29,
            },
            {
              title: 'Asynchronous UP Counter',
              description: 'Asynchronous ripple up counter',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-30.pdf',
              order: 30,
            },
            {
              title: 'Asynchronous DOWN Counter',
              description: 'Asynchronous ripple down counter',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-31.pdf',
              order: 31,
            },
            {
              title: 'Asynchronous UP/DOWN Counter (Posedge)',
              description: 'Bidirectional counter with positive edge trigger',
              type: 'video',
              url: 'https://example.com/de-lesson-7-32.mp4',
              durationSeconds: 1250,
              order: 32,
            },
            {
              title: 'Asynchronous UP/DOWN Counter(Negedge)',
              description: 'Bidirectional counter with negative edge trigger',
              type: 'video',
              url: 'https://example.com/de-lesson-7-33.mp4',
              durationSeconds: 1250,
              order: 33,
            },
            {
              title: 'Advantageous of Synchronous Counters over Asynchronous Counters',
              description: 'Comparison of synchronous vs asynchronous counters',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-34.pdf',
              order: 34,
            },
            {
              title: 'Counting Sequences For Synchronous and Asynchronous counters',
              description: 'Analyzing counting sequences',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-35.pdf',
              order: 35,
            },
            {
              title: 'Ring Counter',
              description: 'Ring counter design and operation',
              type: 'video',
              url: 'https://example.com/de-lesson-7-36.mp4',
              durationSeconds: 1100,
              order: 36,
            },
            {
              title: 'Johnson\'s Counter',
              description: 'Johnson counter design and applications',
              type: 'video',
              url: 'https://example.com/de-lesson-7-37.mp4',
              durationSeconds: 1150,
              order: 37,
            },
            {
              title: 'Multipliers',
              description: 'Digital multiplier circuits',
              type: 'video',
              url: 'https://example.com/de-lesson-7-38.mp4',
              durationSeconds: 1300,
              order: 38,
            },
            {
              title: 'Multipliers Example',
              description: 'Practical multiplier implementation examples',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-39.pdf',
              order: 39,
            },
            {
              title: 'Frequency Division',
              description: 'Using counters for frequency division',
              type: 'video',
              url: 'https://example.com/de-lesson-7-40.mp4',
              durationSeconds: 1100,
              order: 40,
            },
            {
              title: 'Frequency Division using Counters',
              description: 'Practical frequency division techniques',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-41.pdf',
              order: 41,
            },
            {
              title: 'Finite State Machines',
              description: 'Introduction to FSM',
              type: 'video',
              url: 'https://example.com/de-lesson-7-42.mp4',
              durationSeconds: 1400,
              order: 42,
            },
            {
              title: 'FSM Models',
              description: 'Different FSM models and representations',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-43.pdf',
              order: 43,
            },
            {
              title: 'State transition order',
              description: 'Understanding state transition sequences',
              type: 'video',
              url: 'https://example.com/de-lesson-7-44.mp4',
              durationSeconds: 1200,
              order: 44,
            },
            {
              title: 'FSM Designing',
              description: 'Step-by-step FSM design procedure',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-45.pdf',
              order: 45,
            },
            {
              title: 'Finite State Machines Example',
              description: 'Practical FSM design examples',
              type: 'video',
              url: 'https://example.com/de-lesson-7-46.mp4',
              durationSeconds: 1350,
              order: 46,
            },
            {
              title: 'Mealy model FSM',
              description: 'Mealy machine model design',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-47.pdf',
              order: 47,
            },
            {
              title: 'Moore model FSM',
              description: 'Moore machine model design',
              type: 'pdf',
              url: 'https://example.com/de-lesson-7-48.pdf',
              order: 48,
            },
            {
              title: 'Odd parity detector',
              description: 'Design of odd parity detector FSM',
              type: 'video',
              url: 'https://example.com/de-lesson-7-49.mp4',
              durationSeconds: 1100,
              order: 49,
            },
          ],
        },
        {
          title: 'Glitches and Hazards',
          order: 8,
          lessons: [
            {
              title: 'Introduction',
              description: 'Overview of glitches and hazards',
              type: 'video',
              url: 'https://example.com/de-lesson-8-1.mp4',
              durationSeconds: 1200,
              order: 1,
            },
            {
              title: 'Types of Hazards',
              description: 'Static and dynamic hazards in digital circuits',
              type: 'pdf',
              url: 'https://example.com/de-lesson-8-2.pdf',
              order: 2,
            },
            {
              title: 'Elimination Techniques of Hazards',
              description: 'Methods for eliminating hazards',
              type: 'video',
              url: 'https://example.com/de-lesson-8-3.mp4',
              durationSeconds: 1350,
              order: 3,
            },
          ],
        },
        {
          title: 'Memories and PLDs',
          order: 9,
          lessons: [
            {
              title: 'Memories classification',
              description: 'Classification of memory types',
              type: 'video',
              url: 'https://example.com/de-lesson-9-1.mp4',
              durationSeconds: 1250,
              order: 1,
            },
            {
              title: 'Memory Types',
              description: 'Different types of memory devices',
              type: 'pdf',
              url: 'https://example.com/de-lesson-9-2.pdf',
              order: 2,
            },
            {
              title: 'SRAM vs DRAM',
              description: 'Comparison between static and dynamic RAM',
              type: 'video',
              url: 'https://example.com/de-lesson-9-3.mp4',
              durationSeconds: 1200,
              order: 3,
            },
            {
              title: 'Programmable Logic Devices (PLD)',
              description: 'Introduction to PLDs',
              type: 'video',
              url: 'https://example.com/de-lesson-9-4.mp4',
              durationSeconds: 1350,
              order: 4,
            },
            {
              title: 'PLD Example',
              description: 'Practical PLD implementation examples',
              type: 'pdf',
              url: 'https://example.com/de-lesson-9-5.pdf',
              order: 5,
            },
          ],
        },
      ],
    });

    console.log('✓ Digital Electronics Course created');

    console.log('\n=== Seed Data Summary ===');
    console.log(`Admin: ${admin.email} / admin123`);
    console.log(`Instructor 1: ${instructor1.email} / instructor123`);
    console.log(`Instructor 2: ${instructor2.email} / instructor123`);
    console.log(`Students: student1@lms.com to student10@lms.com / student123`);
    console.log(`Course: ${digitalElectronicsCourse.title}`);

    process.exit(0);
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
};

seedData();


