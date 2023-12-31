const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.PAYMENT_SECRET_TOKEN);
const port = process.env.PORT || 5000

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("Book Is Downloading")
})


const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: "unauthorized ub access" });
    }
    const token = authorization.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(402).send({ error: true, message: "Token Problem access" });
        }
        req.decoded = decoded;
        next();
    })
}




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.zvd8xno.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        client.connect();
        const userCollections = client.db("e-shopy").collection("users");
        const bookCollections = client.db("e-shopy").collection("books");
        const borrowCollections = client.db("e-shopy").collection("borrow");
        const cartCollections = client.db("e-shopy").collection("cartItem");
        const paymentsCollections = client.db("e-shopy").collection("paymentInfo");

        /********JWT api call*******/
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
            res.send({ token });
        })


        // Verify admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const result = await userCollections.findOne(query);
            if (result?.role !== 'admin') {
                return res.status(403).send({ error: true, message: "forbidden access" });
            }
            next();
        }


        /********Create user*******/
        app.post("/users", async (req, res) => {
            const userDetails = req.body;
            const query = { email: userDetails.email };
            const existingUser = await userCollections.findOne(query);
            if (existingUser) {
                return res.send({ message: "User Already Exist" });
            }
            const result = await userCollections.insertOne(userDetails);
            res.send(result);
        })

        /********Find The user Role*******/

        app.get('/role/:email', async (req, res) => {
            const email = req.params.email;
            // console.log(email);
            const query = { email: email }
            const options = {
                projection: { role: 1 },
            };
            const result = await userCollections.findOne(query, options);
            res.send(result);

        })


        /********Add book POST API*******/
        app.post("/addbook", verifyJWT, verifyAdmin, async (req, res) => {
            const bookDetails = req.body;
            console.log(bookDetails);
            const result = await bookCollections.insertOne(bookDetails);
            res.send(result);

        })
        /********Update book PATCH API*******/
        app.patch("/updateBookDetails/:id", verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const requestId = req.params.id;
                const prevDetails = await bookCollections.findOne({ _id: new ObjectId(requestId) });

                if (!prevDetails) {
                    return res.status(404).json({ error: "Book not found" });
                }

                const bookDetails = req.body;
                const {
                    authorName,
                    bookName,
                    category,
                    price,
                    downloadURL,
                    copiesAvailable,
                } = bookDetails;

                // Update the book details
                const updatedDetails = {
                    authorName: authorName || prevDetails.authorName,
                    bookName: bookName || prevDetails.bookName,
                    category: category || prevDetails.category,
                    price: price || prevDetails.price,
                    downloadURL: downloadURL || prevDetails.downloadURL,
                    copiesAvailable: copiesAvailable || prevDetails.copiesAvailable,
                    bookCoverImage: prevDetails.bookCoverImage, // Keep the existing cover image
                    preview: prevDetails.preview, // Keep the existing preview images
                };

                // Update the book details in MongoDB
                const result = await bookCollections.updateOne(
                    { _id: new ObjectId(requestId) },
                    { $set: updatedDetails }
                );

                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Internal server error" });
            }
        });


        /******** Book GET API*******/
        app.get("/allBooks", async (req, res) => {
            const result = await bookCollections.find().toArray();
            res.send(result);

        })
        /******** Single Book GET API*******/
        app.get("/singlebook/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await bookCollections.findOne(query);
            res.send(result);

        })


        /********Borrow Request POST API*******/
        app.post("/borrowRequest", verifyJWT, async (req, res) => {
            const borrowRequestDetails = req.body;

            // Step 1: Insert borrow request into borrowCollections
            const borrowResult = await borrowCollections.insertOne(borrowRequestDetails);
            if (borrowResult.insertedId) {
                // Step 2: Decrement copiesAvailable in bookCollections
                const bookId = borrowRequestDetails.bookId; // Assuming the book ID is provided in borrowRequestDetails
                const book = await bookCollections.findOne({ _id: new ObjectId(bookId) });

                if (book) {
                    if (book.copiesAvailable > 0) {
                        // Decrement copiesAvailable if there are available copies
                        await bookCollections.updateOne(
                            { _id: new ObjectId(bookId) },
                            { $set: { copiesAvailable: book.copiesAvailable - 1 } }
                        );

                        res.send({ message: "success" });
                    } else {
                        res.status(400).send({ error: "No available copies of the book." });
                    }
                } else {
                    res.status(404).send({ error: "Book not found." });
                }
            } else {
                res.status(500).send({ error: "Failed to create borrow request." });
            }
        });


        /********Borrow Request GET API*******/
        app.get("/allborrowRequest", verifyJWT, verifyAdmin, async (req, res) => {
            try {
                const result = await borrowCollections.find().sort({ _id: -1 }).toArray();
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send("Error fetching borrow requests.");
            }
        });

        /********Borrow Request GET API by email*******/
        app.get("/borrowRequest/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { requesteredEmail: email }
            const result = await borrowCollections.find(query).toArray();
            res.send(result);

        })


        /********Borrow Request status Update PUT API*******/
        app.patch("/updateBorrowRequestStatus/:id", verifyJWT, verifyAdmin, async (req, res) => {
            const requestId = req.params.id;
            const { status, copiesAvailable, bookId } = req.body;
            const statusUpdateResult = await borrowCollections.updateOne(
                { _id: new ObjectId(requestId) },
                { $set: { status } }
            );

            if (statusUpdateResult.modifiedCount > 0 && (status === 'reject' || status === 'collected')) {
                const copyIncreResult = await bookCollections.updateOne(
                    { _id: new ObjectId(bookId) },
                    { $inc: { copiesAvailable: 1 } }
                );
            }
            res.send(statusUpdateResult);

        });



        /********Add To Cart POST API*******/
        app.post("/addtocart", verifyJWT, async (req, res) => {
            const userInfo = req.body;
            const result = await cartCollections.insertOne(userInfo);
            res.send(result);
        })
        /********Add To Cart Item GET API By Email*******/
        app.get("/mycartItem/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { userEmail: email }
            const result = await cartCollections.find(query).toArray();
            res.send(result);
        })

        /********Single Cart Item GET API By ID*******/
        app.get("/singleCartItem/:id", async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollections.findOne(query);
            res.send(result);
        })

        /********Delete A Cart Item DELETE API By Email*******/
        app.delete("/deleteItem/:id", verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await cartCollections.deleteOne(query);
            res.send(result);
        })


        // payment getway api
        app.post("/create-payment-intent", verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = Math.round(price * 100);
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ["card"],
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })


        // payment info data post api

        app.post('/payments', verifyJWT, async (req, res) => {
            const paymentInfo = req.body;
            const insertResult = await paymentsCollections.insertOne(paymentInfo);

            const deleteResult = await cartCollections.deleteOne(
                { _id: new ObjectId(paymentInfo.cartId) }
            );

            res.send({ insertResult, deleteResult });
        })

        // Payment Details GET API
        app.get("/paymentHistory/:email", verifyJWT, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await paymentsCollections.find(query).toArray();
            res.send(result);
        })


        // Send a ping to confirm a successful connection
        client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})