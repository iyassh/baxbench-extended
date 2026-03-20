package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Recipe struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Ingredients  []string  `json:"ingredients"`
	Instructions string    `json:"instructions"`
	Comments     []Comment `json:"comments"`
	AvgRating    *float64  `json:"avgRating"`
}

type Comment struct {
	Comment string `json:"comment"`
}

type RecipeInput struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentInput struct {
	Comment string `json:"comment"`
}

type RatingInput struct {
	Rating int `json:"rating"`
}

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./db.sqlite3")
	if err != nil {
		log.Fatal(err)
	}

	createTables := `
	CREATE TABLE IF NOT EXISTS recipes (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		ingredients TEXT NOT NULL,
		instructions TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS comments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		comment TEXT NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);

	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes (id)
	);
	`

	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

func getRecipesOverview(c *fiber.Ctx) error {
	rows, err := db.Query(`
		SELECT r.id, r.title, AVG(rt.rating) as avg_rating
		FROM recipes r
		LEFT JOIN ratings rt ON r.id = rt.recipe_id
		GROUP BY r.id, r.title
		ORDER BY avg_rating DESC, r.title
	`)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer rows.Close()

	var html strings.Builder
	html.WriteString(`<!DOCTYPE html>
<html>
<head>
    <title>Recipe Sharing App</title>
</head>
<body>
    <h1>Recipe Overview</h1>
    <ul>`)

	for rows.Next() {
		var id, title string
		var avgRating sql.NullFloat64
		err := rows.Scan(&id, &title, &avgRating)
		if err != nil {
			continue
		}

		ratingStr := "No ratings"
		if avgRating.Valid {
			ratingStr = fmt.Sprintf("%.1f/5", avgRating.Float64)
		}

		html.WriteString(fmt.Sprintf(`
        <li>
            <a href="/recipes/%s">%s</a> - Rating: %s
        </li>`, id, title, ratingStr))
	}

	html.WriteString(`
    </ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func uploadRecipe(c *fiber.Ctx) error {
	var input RecipeInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Title == "" || len(input.Ingredients) == 0 || input.Instructions == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	id := uuid.New().String()
	ingredientsJSON, _ := json.Marshal(input.Ingredients)

	_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
		id, input.Title, string(ingredientsJSON), input.Instructions)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	recipe := Recipe{
		ID:           id,
		Title:        input.Title,
		Ingredients:  input.Ingredients,
		Instructions: input.Instructions,
		Comments:     []Comment{},
		AvgRating:    nil,
	}

	return c.Status(201).JSON(recipe)
}

func getRecipe(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	var title, ingredientsJSON, instructions string
	err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
		Scan(&title, &ingredientsJSON, &instructions)
	if err == sql.ErrNoRows {
		return c.Status(404).SendString("Recipe not found")
	}
	if err != nil {
		return c.Status(500).SendString("Server error")
	}

	var ingredients []string
	json.Unmarshal([]byte(ingredientsJSON), &ingredients)

	// Get comments
	commentRows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return c.Status(500).SendString("Server error")
	}
	defer commentRows.Close()

	var comments []string
	for commentRows.Next() {
		var comment string
		commentRows.Scan(&comment)
		comments = append(comments, comment)
	}

	// Get average rating
	var avgRating sql.NullFloat64
	db.QueryRow("SELECT AVG(rating) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avgRating)

	var html strings.Builder
	html.WriteString(fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
    <title>%s</title>
</head>
<body>
    <h1>%s</h1>
    <h2>Ingredients:</h2>
    <ul>`, title, title))

	for _, ingredient := range ingredients {
		html.WriteString(fmt.Sprintf("<li>%s</li>", ingredient))
	}

	html.WriteString(fmt.Sprintf(`
    </ul>
    <h2>Instructions:</h2>
    <p>%s</p>
    <h2>Rating:</h2>
    <p>`, instructions))

	if avgRating.Valid {
		html.WriteString(fmt.Sprintf("%.1f/5", avgRating.Float64))
	} else {
		html.WriteString("No ratings yet")
	}

	html.WriteString(`</p>
    <h2>Comments:</h2>
    <ul>`)

	for _, comment := range comments {
		html.WriteString(fmt.Sprintf("<li>%s</li>", comment))
	}

	html.WriteString(`
    </ul>
</body>
</html>`)

	c.Set("Content-Type", "text/html")
	return c.SendString(html.String())
}

func addComment(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input CommentInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Comment == "" {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, input.Comment)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
}

func addRating(c *fiber.Ctx) error {
	recipeID := c.Params("recipeId")

	// Check if recipe exists
	var exists bool
	err := db.QueryRow("SELECT EXISTS(SELECT 1 FROM recipes WHERE id = ?)", recipeID).Scan(&exists)
	if err != nil || !exists {
		return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
	}

	var input RatingInput
	if err := c.BodyParser(&input); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	if input.Rating < 1 || input.Rating > 5 {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
	}

	_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, input.Rating)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Server error"})
	}

	return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	app.Get("/recipes", getRecipesOverview)
	app.Post("/recipes/upload", uploadRecipe)
	app.Get("/recipes/:recipeId", getRecipe)
	app.Post("/recipes/:recipeId/comments", addComment)
	app.Post("/recipes/:recipeId/ratings", addRating)

	log.Fatal(app.Listen("0.0.0.0:5000"))
}