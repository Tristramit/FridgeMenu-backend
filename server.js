const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

// Connect to the SQLite database
const db = new sqlite3.Database('menus.db', (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
    }
});

// Middleware to parse JSON body
app.use(express.json());

// GET endpoint to retrieve the full menu for a specific date
app.get('/getMenu', (req, res) => {
    const date = req.query.date;

    if (!date) {
        return res.status(400).json({ error: 'Date parameter is required' });
    }

    const query = `
        SELECT m.date,
               b.name AS breakfast,
               l.name AS lunch,
               d.name AS dinner
        FROM menus m
        LEFT JOIN meals b ON m.breakfast_id = b.id
        LEFT JOIN meals l ON m.lunch_id = l.id
        LEFT JOIN meals d ON m.dinner_id = d.id
        WHERE m.date = ?
    `;

    db.get(query, [date], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (row) {
            res.json({
                date: row.date,
                breakfast: row.breakfast,
                lunch: row.lunch,
                dinner: row.dinner
            });
        } else {
            res.status(404).json({ error: 'Menu not available for this date' });
        }
    });
});

// POST endpoint to add or update a menu
app.post('/addMenu', (req, res) => {
    const { date, breakfast, lunch, dinner } = req.body;

    if (!date || !breakfast || !lunch || !dinner) {
        return res.status(400).json({ error: 'Date, breakfast, lunch, and dinner are required' });
    }

    // Function to get meal ID by name and category
    const getMealId = (name, category) => {
        return new Promise((resolve, reject) => {
            const query = `SELECT id FROM meals WHERE name = ? AND category = ?`;
            db.get(query, [name, category], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(row.id);
                } else {
                    reject(new Error(`Meal "${name}" not found in category "${category}"`));
                }
            });
        });
    };

    Promise.all([
        getMealId(breakfast, 'breakfast'),
        getMealId(lunch, 'lunch'),
        getMealId(dinner, 'dinner')
    ])
    .then(([breakfast_id, lunch_id, dinner_id]) => {
        const insertOrReplace = `
            INSERT INTO menus (date, breakfast_id, lunch_id, dinner_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                breakfast_id=excluded.breakfast_id,
                lunch_id=excluded.lunch_id,
                dinner_id=excluded.dinner_id
        `;
        db.run(insertOrReplace, [date, breakfast_id, lunch_id, dinner_id], function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: `Menu for ${date} added/updated successfully` });
        });
    })
    .catch((err) => {
        res.status(400).json({ error: err.message });
    });
});

// GET endpoint to retrieve all meals by category
app.get('/getMeals', (req, res) => {
    const category = req.query.category;

    if (!category) {
        return res.status(400).json({ error: 'Category parameter is required' });
    }

    const validCategories = ['breakfast', 'lunch', 'dinner'];
    if (!validCategories.includes(category.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid category. Must be breakfast, lunch, or dinner' });
    }

    const query = `SELECT id, name FROM meals WHERE category = ?`;

    db.all(query, [category.toLowerCase()], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ meals: rows });
    });
});

// POST endpoint to add a new meal
app.post('/addMeal', (req, res) => {
    const { name, category } = req.body;

    if (!name || !category) {
        return res.status(400).json({ error: 'Name and category are required' });
    }

    const validCategories = ['breakfast', 'lunch', 'dinner'];
    if (!validCategories.includes(category.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid category. Must be breakfast, lunch, or dinner' });
    }

    const query = `INSERT INTO meals (name, category) VALUES (?, ?)`;

    db.run(query, [name, category.toLowerCase()], function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                return res.status(400).json({ error: `Meal "${name}" already exists in category "${category}"` });
            }
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: `Meal "${name}" added to category "${category}" successfully`, mealId: this.lastID });
    });
});
// POST endpoint to change a specific meal in the menu
app.post('/changeMeal', (req, res) => {
    const { date, category, newMeal } = req.body;

    if (!date || !category || !newMeal) {
        return res.status(400).json({ error: 'Date, category, and newMeal are required' });
    }

    const validCategories = ['breakfast', 'lunch', 'dinner'];
    if (!validCategories.includes(category.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid category. Must be breakfast, lunch, or dinner' });
    }

    // Function to get the new meal ID (and name if random)
    const getMealId = (name, category) => {
        return new Promise((resolve, reject) => {
            if (name.toLowerCase() === 'random') {
                // Select a random meal from the given category
                const query = `SELECT id, name FROM meals WHERE category = ? ORDER BY RANDOM() LIMIT 1`;
                db.get(query, [category.toLowerCase()], (err, row) => {
                    if (err) {
                        reject(err);
                    } else if (row) {
                        resolve({ id: row.id, name: row.name });
                    } else {
                        reject(new Error(`No meals found in category "${category}"`));
                    }
                });
            } else {
                // Find the meal by name and category
                const query = `SELECT id FROM meals WHERE name = ? AND category = ?`;
                db.get(query, [name, category.toLowerCase()], (err, row) => {
                    if (err) {
                        reject(err);
                    } else if (row) {
                        resolve({ id: row.id, name: name });
                    } else {
                        reject(new Error(`Meal "${name}" not found in category "${category}"`));
                    }
                });
            }
        });
    };

    // Get the current menu for the date
    const getCurrentMenu = () => {
        return new Promise((resolve, reject) => {
            const query = `SELECT * FROM menus WHERE date = ?`;
            db.get(query, [date], (err, row) => {
                if (err) {
                    reject(err);
                } else if (row) {
                    resolve(row);
                } else {
                    reject(new Error(`Menu for date "${date}" not found`));
                }
            });
        });
    };

    Promise.all([getMealId(newMeal, category), getCurrentMenu()])
        .then(([newMealResult, currentMenu]) => {
            const newMealId = newMealResult.id;
            const newMealName = newMealResult.name;

            let updateQuery = '';
            let params = [];

            switch (category.toLowerCase()) {
                case 'breakfast':
                    updateQuery = `UPDATE menus SET breakfast_id = ? WHERE date = ?`;
                    params = [newMealId, date];
                    break;
                case 'lunch':
                    updateQuery = `UPDATE menus SET lunch_id = ? WHERE date = ?`;
                    params = [newMealId, date];
                    break;
                case 'dinner':
                    updateQuery = `UPDATE menus SET dinner_id = ? WHERE date = ?`;
                    params = [newMealId, date];
                    break;
            }

            db.run(updateQuery, params, function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({
                    success: `Menu for ${date} updated: ${category} changed to "${newMealName}"`,
                    newMeal: newMealName
                });
            });
        })
        .catch((err) => {
            res.status(400).json({ error: err.message });
        });
});


// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
