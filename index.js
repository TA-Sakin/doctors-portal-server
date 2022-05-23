const { MongoClient, ServerApiVersion } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const jwt = require("jsonwebtoken");
const nodemailer = require('nodemailer');
const mg = require('nodemailer-mailgun-transport');
const port = process.env.PORT || 5000;
app.use(cors());
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header('Access-Control-Allow-Methods', 'DELETE, PUT, GET, POST');
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.uwnmc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});
function verifyJWT(req,res,next){
  const authHeader = req.headers.authorization
  if(!authHeader){
    res.status(401).send({message: 'Unauthorized access'});
  }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function(err, decoded) {
      if(err){
        return res.status(403).send({message: 'Forbidden access'})
      }
      req.decoded = decoded
      next()
    });
}

function sendAppointmentEmail(booking){
  const {patient, patientName, treatment, date, slot} = booking;
  const email = {
    from: 'myemail@example.com',
    to: 'altahjib10@gmail.com',
    subject: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
    <div>
    <p>Hello, ${patientName}</p>
    <h3>Your appointment for ${treatment} is confirmed!</h3>
    <p>Looking forward to seeing you on ${date} at ${slot}.</p>
    <h3>Our address</h3>
    <p>Chittagong,Bangladesh</p>
    <a href="https://github.com/TA-Sakin">unsubscribe</a>
    </div>
    `,
    text: `Your appointment for ${treatment} is on ${date} at ${slot} is confirmed`
  }
  nodemailerMailgun.sendMail(email, (err, info) => {
    if (err) {
      console.log(err);
    }
    else {
      console.log(info);
    }
  });
}
const auth = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
    domain: 'sandboxd96939b91c8047c2acb2afcd3f91dcf4.mailgun.org'
  }
}
const nodemailerMailgun = nodemailer.createTransport(mg(auth));

async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db("doctorsPortal").collection("services");
    const bookingCollection = client.db("doctorsPortal").collection("booking");
    const userCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");

    const verifyAdmin = async (req,res,next)=>{
      const requestor = req.decoded.email;
          const requestorAccount = await userCollection.findOne({email:requestor})
          if(requestorAccount.role === 'admin'){
            next()
          }
          else{
            res.status(403).send({message: 'forbidden'})
          }
    }

    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({name:1});
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email
      if(patient === decodedEmail){
        const query = { patient: patient };
        const cursor = bookingCollection.find(query);
        const result = await cursor.toArray();
        return res.send(result);
      }
      else{
        return res.status(403).send({message: 'Forbidden access'})
      }
    });
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      sendAppointmentEmail( booking)
      res.send({ success: true, result });
    });

    //not the proper way use mongodb's aggregation, pipeline lookup
    app.get("/available", async (req, res) => {
      const date = req.query.date;

      // step 1:  get all services
      const services = await serviceCollection.find().toArray();

      // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: for each service
      services.forEach((service) => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map((book) => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        //step 7: set available to slots to make it easier
        service.slots = available;
      });

      res.send(services);
    });

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
        const filter = { email: email };
        const updateDoc = {
          $set: {role: 'admin'},
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
    });
    app.get('/admin/:email', async(req,res)=>{
      const email = req.params.email;
      const user = await userCollection.findOne({email:email})
      const isAdmin = user.role === 'admin'
      res.send({admin: isAdmin})
    })
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({result, token});
    });

    app.post('/doctors', verifyJWT, verifyAdmin, async(req,res)=>{
      const doctors = req.body;
      const result = await doctorsCollection.insertOne(doctors)
      res.send(result)
    })

    app.get("/doctors", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorsCollection.find().toArray();
      res.send(doctors);
    });
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = {email: email}
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    });
  } finally {
    // client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World from doctors portal.");
});

app.listen(port, () => {
  console.log(`Doctors portal listening on port ${port}`);
});
