package main

import (
	"database/sql"
	"fmt"
	"html"
	"log"
	"sort"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
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
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	CREATE TABLE IF NOT EXISTS ratings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		recipe_id TEXT NOT NULL,
		rating INTEGER NOT NULL,
		FOREIGN KEY (recipe_id) REFERENCES recipes(id)
	);
	`
	_, err = db.Exec(createTables)
	if err != nil {
		log.Fatal(err)
	}
}

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

type UploadRequest struct {
	Title        string   `json:"title"`
	Ingredients  []string `json:"ingredients"`
	Instructions string   `json:"instructions"`
}

type CommentRequest struct {
	Comment string `json:"comment"`
}

type RatingRequest struct {
	Rating int `json:"rating"`
}

func getAvgRating(recipeID string) *float64 {
	var avg sql.NullFloat64
	err := db.QueryRow("SELECT AVG(CAST(rating AS FLOAT)) FROM ratings WHERE recipe_id = ?", recipeID).Scan(&avg)
	if err != nil || !avg.Valid {
		return nil
	}
	val := avg.Float64
	return &val
}

func getComments(recipeID string) []Comment {
	rows, err := db.Query("SELECT comment FROM comments WHERE recipe_id = ?", recipeID)
	if err != nil {
		return []Comment{}
	}
	defer rows.Close()

	var comments []Comment
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.Comment); err == nil {
			comments = append(comments, c)
		}
	}
	if comments == nil {
		comments = []Comment{}
	}
	return comments
}

func main() {
	initDB()
	defer db.Close()

	app := fiber.New()

	// GET /recipes - overview of recipes
	app.Get("/recipes", func(c *fiber.Ctx) error {
		rows, err := db.Query("SELECT id, title FROM recipes ORDER BY rowid DESC")
		if err != nil {
			return c.Status(500).SendString("Server error")
		}
		defer rows.Close()

		type recipeSummary struct {
			ID        string
			Title     string
			AvgRating *float64
		}

		var recipes []recipeSummary
		for rows.Next() {
			var r recipeSummary
			if err := rows.Scan(&r.ID, &r.Title); err != nil {
				return c.Status(500).SendString("Server error")
			}
			r.AvgRating = getAvgRating(r.ID)
			recipes = append(recipes, r)
		}

		// Build top-rated list (sorted by avg rating descending)
		topRated := make([]recipeSummary, len(recipes))
		copy(topRated, recipes)
		sort.Slice(topRated, func(i, j int) bool {
			ri := topRated[i].AvgRating
			rj := topRated[j].AvgRating
			if ri == nil && rj == nil {
				return false
			}
			if ri == nil {
				return false
			}
			if rj == nil {
				return true
			}
			return *ri > *rj
		})

		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>Recipe Overview</title></head><body>")
		sb.WriteString("<h1>Recent Recipes</h1><ul>")
		for _, r := range recipes {
			ratingStr := "No ratings"
			if r.AvgRating != nil {
				ratingStr = fmt.Sprintf("%.1f", *r.AvgRating)
			}
			sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> (Avg Rating: %s)</li>`, html.EscapeString(r.ID), html.EscapeString(r.Title), ratingStr))
		}
		sb.WriteString("</ul>")

		sb.WriteString("<h1>Top Rated Recipes</h1><ul>")
		for _, r := range topRated {
			ratingStr := "No ratings"
			if r.AvgRating != nil {
				ratingStr = fmt.Sprintf("%.1f", *r.AvgRating)
			}
			sb.WriteString(fmt.Sprintf(`<li><a href="/recipes/%s">%s</a> (Avg Rating: %s)</li>`, html.EscapeString(r.ID), html.EscapeString(r.Title), ratingStr))
		}
		sb.WriteString("</ul>")
		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(sb.String())
	})

	// POST /recipes/upload - upload a new recipe
	app.Post("/recipes/upload", func(c *fiber.Ctx) error {
		var req UploadRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.Title == "" || len(req.Ingredients) == 0 || req.Instructions == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input: title, ingredients, and instructions are required"})
		}

		id := uuid.New().String()
		ingredientsStr := strings.Join(req.Ingredients, "|||")

		_, err := db.Exec("INSERT INTO recipes (id, title, ingredients, instructions) VALUES (?, ?, ?, ?)",
			id, req.Title, ingredientsStr, req.Instructions)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to create recipe"})
		}

		recipe := Recipe{
			ID:           id,
			Title:        req.Title,
			Ingredients:  req.Ingredients,
			Instructions: req.Instructions,
			Comments:     []Comment{},
			AvgRating:    nil,
		}

		return c.Status(201).JSON(recipe)
	})

	// GET /recipes/:recipeId - get a recipe
	app.Get("/recipes/:recipeId", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		var title, ingredientsStr, instructions string
		err := db.QueryRow("SELECT title, ingredients, instructions FROM recipes WHERE id = ?", recipeID).
			Scan(&title, &ingredientsStr, &instructions)
		if err != nil {
			return c.Status(404).SendString("Recipe not found")
		}

		ingredients := strings.Split(ingredientsStr, "|||")
		comments := getComments(recipeID)
		avgRating := getAvgRating(recipeID)

		var sb strings.Builder
		sb.WriteString("<!DOCTYPE html><html><head><title>" + html.EscapeString(title) + "</title></head><body>")
		sb.WriteString("<h1>" + html.EscapeString(title) + "</h1>")

		sb.WriteString("<h2>Ingredients</h2><ul>")
		for _, ing := range ingredients {
			sb.WriteString("<li>" + html.EscapeString(ing) + "</li>")
		}
		sb.WriteString("</ul>")

		sb.WriteString("<h2>Instructions</h2>")
		sb.WriteString("<p>" + html.EscapeString(instructions) + "</p>")

		sb.WriteString("<h2>Average Rating</h2>")
		if avgRating != nil {
			sb.WriteString(fmt.Sprintf("<p>%.1f / 5</p>", *avgRating))
		} else {
			sb.WriteString("<p>No ratings yet</p>")
		}

		sb.WriteString("<h2>Comments</h2><ul>")
		for _, cm := range comments {
			sb.WriteString("<li>" + html.EscapeString(cm.Comment) + "</li>")
		}
		sb.WriteString("</ul>")
		sb.WriteString("</body></html>")

		c.Set("Content-Type", "text/html")
		return c.Status(200).SendString(sb.String())
	})

	// POST /recipes/:recipeId/comments - add a comment
	app.Post("/recipes/:recipeId/comments", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		// Check if recipe exists
		var exists int
		err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
		if err != nil || exists == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		var req CommentRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.Comment == "" {
			return c.Status(400).JSON(fiber.Map{"error": "Comment is required"})
		}

		_, err = db.Exec("INSERT INTO comments (recipe_id, comment) VALUES (?, ?)", recipeID, req.Comment)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add comment"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Comment added successfully"})
	})

	// POST /recipes/:recipeId/ratings - rate a recipe
	app.Post("/recipes/:recipeId/ratings", func(c *fiber.Ctx) error {
		recipeID := c.Params("recipeId")

		// Check if recipe exists
		var exists int
		err := db.QueryRow("SELECT COUNT(*) FROM recipes WHERE id = ?", recipeID).Scan(&exists)
		if err != nil || exists == 0 {
			return c.Status(404).JSON(fiber.Map{"error": "Recipe not found"})
		}

		var req RatingRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Invalid input"})
		}

		if req.Rating < 1 || req.Rating > 5 {
			return c.Status(400).JSON(fiber.Map{"error": "Rating must be between 1 and 5"})
		}

		_, err = db.Exec("INSERT INTO ratings (recipe_id, rating) VALUES (?, ?)", recipeID, req.Rating)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "Failed to add rating"})
		}

		return c.Status(201).JSON(fiber.Map{"message": "Rating added successfully"})
	})

	log.Fatal(app.Listen("0.0.0.0:5000"))
}