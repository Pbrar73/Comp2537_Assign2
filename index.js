
require("./utils.js");

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;

const port = 3020;

const app = express();

const Joi = require("joi");


const expireTime = 24 * 60 * 60 * 1000; //expires after 1 day  (hours * minutes * seconds * millis)

/* secret information section */
const mongodb_host = process.env.MONGODB_HOST;
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_database = process.env.MONGODB_DATABASE;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;
/* END secret section */

var { database } = include('databaseConnection');

const userCollection = database.db(mongodb_database).collection('users');

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: false }));

var mongoStore = MongoStore.create({
    mongoUrl: `mongodb+srv://${mongodb_user}:${mongodb_password}@${mongodb_host}/sessions`,
    crypto: {
        secret: mongodb_session_secret
    }
})

app.use(express.json());
app.use(session({
    secret: node_session_secret,
    store: mongoStore, //default is memory store 
    saveUninitialized: false,
    resave: true
}
));

function adminAuthenticate(req,res,next){
    if(req.session.authenticated){
        if(req.session.user_type == "admin"){
            next();
        }else{
            res.status(403);
            res.render('errorMess', {mess: "You are not authorized to view this page."});
        }
    } else {
        res.redirect("/login");
    }
}

function sessionAuthenticate(req,res,next){
    if(req.session.authenticated){
        next();
    } else {
        res.redirect("/login");
    }
}

app.get('/', (req, res) => {
    res.render("index", { session: req.session });
});

app.get('/nosql-injection', async (req, res) => {
    var username = req.query.user;

    if (!username) {
        res.send(`<h3>no user provided - try /nosql-injection?user=name</h3> <h3>or /nosql-injection?user[$ne]=name</h3>`);
        return;
    }
    console.log("user: " + username);

    const schema = Joi.string().max(20).required();
    const validationResult = schema.validate(username);

    //If we didn't use Joi to validate and check for a valid URL parameter below
    // we could run our userCollection.find and it would be possible to attack.
    // A URL parameter of user[$ne]=name would get executed as a MongoDB command
    // and may result in revealing information about all users or a successful
    // login without knowing the correct password.
    if (validationResult.error != null) {
        console.log(validationResult.error);
        res.send("<h1 style='color:darkred;'>A NoSQL injection attack was detected!!</h1>");
        return;
    }

    const result = await userCollection.find({ username: username }).project({ username: 1, password: 1, _id: 1 }).toArray();

    console.log(result);

    res.send(`<h1>Hello ${username}</h1>`);
});

app.get('/about', (req, res) => {
    var color = req.query.color;

    res.render("about", { color: color });
});

app.get('/contact', (req, res) => {
    var missingEmail = req.query.missing;

    res.render("contact", { missing: missingEmail });
});

app.post('/submitEmail', (req, res) => {
    var email = req.body.email;
    if (!email) {
        res.redirect('/contact?missing=1');
    }
    else {
        res.render("submitEmail", { email: email });
    }
});


app.get('/createUser', (req, res) => {
    res.render("createUser");
});


app.get('/members', (req, res) => {
    if (!req.session.authenticated) {
        res.redirect('/');
    } else {
        var picnum = Math.floor(Math.random() * 3);
        var picname = "";
        if (picnum == 0) {
            picname = "gorilla1.jpg";
        } else if (picnum == 1) {
            picname = "gorilla2.jpg";
        } else {
            picname = "gorilla3.jpg";
        }
        res.render('members', { username: req.session.username, picname: picname });
    }
});

app.get('/login', (req, res) => {
    res.render("login");
});

app.post('/submitUser', async (req, res) => {
    var username = req.body.username;
    var password = req.body.password;

    const schema = Joi.object(
        {
            username: Joi.string().alphanum().max(20).required(),
            password: Joi.string().max(20).required()
        });

    const validationResult = schema.validate({ username, password });
    if (validationResult.error != null) {
        console.log(validationResult.error);
        res.redirect("/createUser");
        return;
    }

    var hashedPassword = await bcrypt.hash(password, saltRounds);

    await userCollection.insertOne({ username: username, password: hashedPassword });
    console.log("Inserted user");

    var html = "successfully created user";
    res.render("submitUser", { html: html });
});

app.post('/loggingin', async (req, res) => {
    var username = req.body.username;
    var password = req.body.password;

    const schema = Joi.string().max(20).required();
    const validationResult = schema.validate(username);
    if (validationResult.error != null) {
        console.log(validationResult.error);
        res.redirect("/login");
        return;
    }

    const result = await userCollection.find({ username: username }).project({ username: 1, password: 1, _id: 1 }).toArray();

    console.log(result);
    if (result.length != 1) {
        console.log("user not found");
        res.redirect("/login");
        return;
    }
    if (await bcrypt.compare(password, result[0].password)) {
        console.log("correct password");
        req.session.authenticated = true;
        req.session.username = username;
        req.session.cookie.maxAge = expireTime;

        res.redirect('/loggedIn');
        return;
    }
    else {
        console.log("incorrect password");
        res.redirect("/login");
        return;
    }
});

app.get('/loggedin', (req, res) => {
    if (!req.session.authenticated) {
        res.redirect('/login');
    }
    res.render("loggedin");
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.render("loggedout");
});


app.get('/admin', sessionAuthenticate, adminAuthenticate, async (req, res) => {
    const result = await userCollection.find({}).project({ email: 1, username: 1, user_type: 1, _id: 1 }).toArray();
    res.render('admin', { users: result });
});

app.post('/promote', adminAuthenticate, async (req, res) => {
    var username = req.body.username;
    await userCollection.updateOne({ username: username }, { $set: { user_type: 'admin' } });
    res.redirect('/admin');
});

app.post('/demote', adminAuthenticate, async (req, res) => {
    var username = req.body.username;
    await userCollection.updateOne({ username: username }, { $set: { user_type: 'user' } });
    res.redirect('/admin');
});


app.use(express.static(__dirname + "/public"));

app.get("*", (req, res) => {
    res.status(404);
    res.render("404");
})

app.listen(port, () => {
    console.log("Node application listening on port " + port);
});